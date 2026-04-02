import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔍 ========== NOTIFICATION DIAGNOSTICS ==========');

        // Get company
        const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        const company = companies[0];

        if (!company) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        const report = {
            company_name: company.company_name,
            company_id: company.id,
            test_timestamp: new Date().toISOString(),
            checks: {},
            errors: []
        };

        // 1. Check Resend API Key
        console.log('1️⃣ Checking email configuration...');
        const resendKey = Deno.env.get('RESEND_API_KEY');
        report.checks.resend_configured = !!resendKey;
        if (!resendKey) {
            report.errors.push('❌ RESEND_API_KEY not configured - emails will fail');
        } else {
            console.log('✅ Resend API key found');
        }

        // 2. Check Twilio Configuration
        console.log('2️⃣ Checking SMS configuration...');
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: company.id });
        report.checks.twilio_configured = twilioSettings.length > 0 && twilioSettings[0].account_sid && twilioSettings[0].auth_token;
        if (!report.checks.twilio_configured) {
            report.errors.push('❌ Twilio not configured - SMS will fail');
        } else {
            console.log('✅ Twilio configured');
            report.checks.twilio_phone = twilioSettings[0].main_phone_number;
        }

        // 3. Check Staff Profiles
        console.log('3️⃣ Checking staff profiles...');
        const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: company.id });
        const admins = staffProfiles.filter(s => s.is_administrator);
        report.checks.total_staff = staffProfiles.length;
        report.checks.admin_count = admins.length;
        report.checks.staff_with_phones = staffProfiles.filter(s => s.phone).length;

        if (admins.length === 0) {
            report.errors.push('⚠️ No administrators found - notifications may not be received');
        }

        // 4. Check Recent Communications
        console.log('4️⃣ Checking recent communications...');
        const recentComms = await base44.asServiceRole.entities.Communication.filter({ company_id: company.id });
        const last24Hours = recentComms.filter(c => {
            const diff = Date.now() - new Date(c.created_date).getTime();
            return diff < 24 * 60 * 60 * 1000;
        });
        report.checks.communications_last_24h = last24Hours.length;
        report.checks.emails_sent_24h = last24Hours.filter(c => c.communication_type === 'email').length;
        report.checks.sms_sent_24h = last24Hours.filter(c => c.communication_type === 'sms').length;

        // 5. Check Active Workflows
        console.log('5️⃣ Checking workflows...');
        const workflows = await base44.asServiceRole.entities.Workflow.filter({ 
            company_id: company.id,
            is_active: true 
        });
        report.checks.active_workflows = workflows.length;
        report.checks.workflow_types = workflows.map(w => w.trigger_type);

        // Test a workflow if any exist
        if (workflows.length > 0) {
            try {
                const testWorkflow = workflows[0];
                console.log(`🧪 Testing workflow: ${testWorkflow.workflow_name}`);

                const testResult = await base44.asServiceRole.functions.invoke('testWorkflow', {
                    workflowId: testWorkflow.id
                });

                if (testResult.data?.success) {
                    report.checks.workflow_test = `✅ SUCCESS - Tested "${testWorkflow.workflow_name}"`;
                } else {
                    report.checks.workflow_test = `❌ FAILED: ${testResult.data?.error || 'Unknown error'}`;
                    report.errors.push(`Workflow test failed: ${testResult.data?.error || 'Unknown'}`);
                }
            } catch (error) {
                report.checks.workflow_test = `❌ FAILED: ${error.message}`;
                report.errors.push(`Workflow test error: ${error.message}`);
            }
        } else {
            report.checks.workflow_test = 'SKIPPED - No workflows configured';
        }

        // 6. Test Email Send
        console.log('6️⃣ Testing email send...');
        if (resendKey) {
            try {
                const emailTest = await base44.asServiceRole.functions.invoke('sendEmailFromCRM', {
                    to: user.email,
                    subject: '🧪 Test Email - Notification System Check',
                    message: `This is an automated test email sent at ${new Date().toLocaleString()}.\n\nIf you received this, your email notifications are working correctly!`,
                    contactName: user.full_name,
                    companyId: company.id
                });
                
                if (emailTest.data?.success) {
                    report.checks.email_test = '✅ SUCCESS - Check your inbox';
                } else {
                    report.checks.email_test = '❌ FAILED: ' + (emailTest.data?.error || 'Unknown error');
                    report.errors.push('Email test failed');
                }
            } catch (error) {
                report.checks.email_test = '❌ FAILED: ' + error.message;
                report.errors.push('Email test error: ' + error.message);
            }
        }

        // 7. Test SMS Send (only if phone configured)
        console.log('7️⃣ Testing SMS send...');
        const myProfile = staffProfiles.find(s => s.user_email === user.email);
        if (report.checks.twilio_configured && myProfile?.phone) {
            try {
                // Format phone number with + if not present
                let phoneNumber = myProfile.phone;
                if (!phoneNumber.startsWith('+')) {
                    phoneNumber = '+1' + phoneNumber.replace(/\D/g, '');
                }
                
                const smsTest = await base44.asServiceRole.functions.invoke('sendSMS', {
                    to: phoneNumber,
                    message: `🧪 Test SMS from ${company.company_name} at ${new Date().toLocaleTimeString()}. Your SMS notifications are working!`,
                    contactName: user.full_name,
                    companyId: company.id
                });
                
                if (smsTest.data?.success) {
                    report.checks.sms_test = '✅ SUCCESS - Check your phone';
                } else {
                    report.checks.sms_test = '❌ FAILED: ' + (smsTest.data?.error || 'Unknown error');
                    report.errors.push('SMS test failed: ' + (smsTest.data?.error || 'Unknown error'));
                }
            } catch (error) {
                report.checks.sms_test = '❌ FAILED: ' + error.message;
                report.errors.push('SMS test error: ' + error.message);
            }
        } else if (!report.checks.twilio_configured) {
            report.checks.sms_test = 'SKIPPED - Twilio not configured';
        } else {
            report.checks.sms_test = 'SKIPPED - No phone number in your staff profile';
        }

        // 8. Check Notification Preferences
        console.log('8️⃣ Checking notification preferences...');
        const preferences = await base44.asServiceRole.entities.NotificationPreference.filter({ company_id: company.id });
        const mutedUsers = preferences.filter(p => p.mute_all_notifications);
        report.checks.users_with_preferences = preferences.length;
        report.checks.users_muted = mutedUsers.length;
        if (mutedUsers.length > 0) {
            report.errors.push(`⚠️ ${mutedUsers.length} users have muted notifications: ${mutedUsers.map(p => p.user_email).join(', ')}`);
        }

        // 9. Summary
        report.summary = {
            status: report.errors.length === 0 ? '✅ ALL SYSTEMS OPERATIONAL' : '⚠️ ISSUES DETECTED',
            critical_errors: report.errors.filter(e => e.includes('❌')).length,
            warnings: report.errors.filter(e => e.includes('⚠️')).length
        };

        console.log('📊 Diagnostic Report:', JSON.stringify(report, null, 2));

        return Response.json({
            success: true,
            report
        });

    } catch (error) {
        console.error('❌ Diagnostic error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});