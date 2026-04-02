import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('🧪 testWorkflow function started');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            console.error('❌ Unauthorized');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('✅ User authenticated:', user.email);

        const body = await req.json();
        const { workflowId } = body;

        if (!workflowId) {
            return Response.json({ error: 'Workflow ID required' }, { status: 400 });
        }

        const workflows = await base44.asServiceRole.entities.Workflow.filter({ id: workflowId });
        
        if (!workflows || workflows.length === 0) {
            return Response.json({ error: 'Workflow not found' }, { status: 404 });
        }

        const workflow = workflows[0];
        console.log('✅ Workflow found:', workflow.workflow_name, 'Actions:', workflow.actions?.length);

        let company = null;
        if (workflow.company_id) {
            const companies = await base44.asServiceRole.entities.Company.filter({ id: workflow.company_id });
            company = companies[0];
        }

        let emailsSent = 0;
        let smsSent = 0;
        let notificationsCreated = 0;
        const errors = [];
        const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

        // 🔔 ALWAYS CREATE A BELL NOTIFICATION FIRST
        try {
            await base44.asServiceRole.entities.Notification.create({
                company_id: workflow.company_id,
                user_email: user.email,
                title: '🧪 Workflow Test Started',
                message: `Testing workflow: ${workflow.workflow_name}`,
                type: 'general',
                is_read: false
            });
            notificationsCreated++;
            console.log('✅ Initial bell notification created');
        } catch (e) {
            console.error('⚠️ Failed to create initial notification:', e);
        }

        for (const action of workflow.actions || []) {
            console.log('📌 Processing action:', action.action_type, 'Step:', action.step);

            if (action.action_type === 'send_email') {
                let recipients = [];
                
                // Parse comma-separated recipients from action.recipient
                const recipientField = action.recipient || '';
                const recipientList = recipientField.split(',').map(r => r.trim()).filter(r => r);
                
                for (const recipient of recipientList) {
                    // If recipient is "customer" or "lead", use default test email
                    if (recipient === 'customer' || recipient === 'lead') {
                        console.log(`🧪 TEST MODE: Converting "${recipient}" → yicnteam@gmail.com`);
                        if (!recipients.includes('yicnteam@gmail.com')) {
                            recipients.push('yicnteam@gmail.com');
                        }
                    } else if (recipient.includes('@')) {
                        recipients.push(recipient);
                    }
                }
                
                // If no valid recipients, use default test email
                if (recipients.length === 0) {
                    console.log(`🧪 TEST MODE: No recipients specified, using yicnteam@gmail.com`);
                    recipients.push('yicnteam@gmail.com');
                }
                
                let subject = action.email_subject || "Test Email";
                let body = action.email_body || "<p>Test email</p>";

                console.log(`📧 Sending test email to: ${recipients.join(', ')}`);
                console.log(`   Subject: ${subject}`);

                try {
                    const resendResponse = await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${RESEND_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            from: `${company?.company_name || 'AI CRM Pro'} <noreply@mycrewcam.com>`,
                            to: recipients,
                            subject: '[TEST] ' + subject,
                            html: `<div style="background:#fff3cd;padding:10px;border:2px solid #ffc107;margin-bottom:20px;">
                                <strong>🧪 TEST EMAIL - WORKFLOW TEST MODE</strong><br>
                                <small>Original recipient setting: "${action.recipient}"</small><br>
                                <small>Sending to: ${recipients.join(', ')}</small>
                            </div>` + body
                        })
                    });

                    const resendData = await resendResponse.json();
                    console.log('📧 Resend response:', JSON.stringify(resendData, null, 2));
                    
                    if (resendResponse.ok) {
                        emailsSent++;
                        console.log('✅ Email sent successfully to:', recipients.join(', '));
                    } else {
                        console.error('❌ Resend error:', resendData);
                        errors.push({ type: 'email', step: action.step, message: resendData.message || 'Email failed' });
                    }
                } catch (e) {
                    console.error('❌ Email error:', e);
                    errors.push({ type: 'email', step: action.step, message: e.message });
                }
            }

            if (action.action_type === 'send_sms') {
                const recipient = action.recipient || '+12168590076';
                let message = action.sms_message || "Test SMS";

                console.log('📱 Sending SMS to:', recipient, 'Company ID:', workflow.company_id);

                try {
                    const smsResult = await base44.asServiceRole.functions.invoke('sendSMS', {
                        to: recipient,
                        message: '[TEST] ' + message,
                        contactName: 'Test User',
                        companyId: workflow.company_id
                    });

                    console.log('📱 SMS result:', JSON.stringify(smsResult));

                    if (smsResult.data?.success) {
                        smsSent++;
                        console.log('✅ SMS sent successfully');
                    } else {
                        console.error('❌ SMS failed:', smsResult.data);
                        errors.push({ type: 'sms', message: smsResult.data?.error || 'SMS failed' });
                    }
                } catch (e) {
                    console.error('❌ SMS error:', e);
                    errors.push({ type: 'sms', message: e.message });
                }
            }

            if (action.action_type === 'send_notification') {
                try {
                    await base44.asServiceRole.entities.Notification.create({
                        company_id: workflow.company_id,
                        user_email: action.recipient || user.email,
                        title: '[TEST] ' + (action.notification_title || 'Test Notification'),
                        message: action.notification_message || 'Test notification',
                        type: 'general',
                        is_read: false
                    });
                    notificationsCreated++;
                    console.log('✅ Notification action created');
                } catch (e) {
                    console.error('❌ Notification error:', e);
                    errors.push({ type: 'notification', message: e.message });
                }
            }
        }

        // 🔔 FINAL BELL NOTIFICATION
        try {
            await base44.asServiceRole.entities.Notification.create({
                company_id: workflow.company_id,
                user_email: user.email,
                title: '✅ Workflow Test Complete',
                message: `Emails: ${emailsSent}, SMS: ${smsSent}, Notifications: ${notificationsCreated}`,
                type: 'general',
                is_read: false
            });
            notificationsCreated++;
            console.log('✅ Final bell notification created');
        } catch (e) {
            console.error('⚠️ Failed to create final notification:', e);
        }

        console.log('✅ Test completed - Emails:', emailsSent, 'SMS:', smsSent, 'Notifications:', notificationsCreated);

        return Response.json({
            success: true,
            message: 'Test workflow executed',
            emailsSent,
            smsSent,
            notificationsCreated,
            errors: errors.length > 0 ? errors : undefined,
            workflowName: workflow.workflow_name
        });

    } catch (error) {
        console.error('💥 ERROR in testWorkflow:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});