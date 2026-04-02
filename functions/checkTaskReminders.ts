import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

// Runs daily to check for tasks stuck in critical columns and send reminders
Deno.serve(async (req) => {
    try {
        // 🔐 Validate CRON_SECRET_TOKEN
        const authToken = Deno.env.get('CRON_SECRET_TOKEN');
        let processedReq = req;
        
        if (authToken) {
            const requestToken = req.headers.get('Authorization')?.replace('Bearer ', '');
            if (requestToken !== authToken) {
                return Response.json({ error: 'Unauthorized - Invalid token' }, { status: 401 });
            }
            // Remove Authorization header so createClientFromRequest doesn't try to parse it as a user token
            const headers = new Headers(req.headers);
            headers.delete('Authorization');
            processedReq = new Request(req.url, { headers, body: req.body, method: req.method });
        }

        const base44 = createClientFromRequest(processedReq);
        
        console.log('🔔 Task Reminder Check Started:', new Date().toISOString());

        // Get all companies
        const companies = await base44.asServiceRole.entities.Company.list();
        
        let totalReminders = 0;
        const now = new Date();
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const company of companies) {
            // Get all active tasks for this company
            const allTasks = await base44.asServiceRole.entities.Task.filter({
                company_id: company.id
            });

            const activeTasks = allTasks.filter(t => !t.is_archived && t.column !== 'job_completed');

            // Rate limiting: Add delay between companies
            await sleep(500);

            // Critical columns that need monitoring
            const criticalColumns = [
                'not_started',
                'in_progress', 
                'awaiting_payment',
                'follow_up_needed',
                'awaiting_feedback'
            ];

            for (const task of activeTasks) {
                let shouldSendReminder = false;
                let reminderReason = '';

                // Check if task is overdue
                if (task.due_date) {
                    const dueDate = new Date(task.due_date);
                    dueDate.setHours(0, 0, 0, 0);
                    const daysPastDue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

                    if (daysPastDue > 0 && daysPastDue % 3 === 0) {
                        shouldSendReminder = true;
                        reminderReason = `${daysPastDue} days overdue`;
                    }
                }

                // Check if task stuck in critical column >3 days
                if (!shouldSendReminder && criticalColumns.includes(task.column)) {
                    const taskAge = Math.floor((now - new Date(task.updated_date)) / (1000 * 60 * 60 * 24));
                    
                    if (taskAge >= 3 && taskAge % 3 === 0) {
                        shouldSendReminder = true;
                        reminderReason = `stuck in "${task.column}" for ${taskAge} days`;
                    }
                }

                if (shouldSendReminder) {
                    // Get assignees
                    const assignees = task.assignees || [];
                    const notifyEmails = new Set();

                    // Notify assignees
                    assignees.forEach(a => notifyEmails.add(a.email));

                    // Notify creator
                    if (task.created_by) {
                        notifyEmails.add(task.created_by);
                    }

                    // Notify admins (but only ONE notification per user, not per admin)
                    const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ 
                        company_id: company.id 
                    });
                    const adminEmails = allStaff.filter(s => s.is_administrator).map(s => s.user_email);
                    adminEmails.forEach(email => notifyEmails.add(email));
                    
                    console.log(`📧 Will notify ${notifyEmails.size} unique users for task ${task.id}`);

                    // Get customer/lead name if available
                    let contactName = task.related_to || null;
                    
                    // Skip tasks without valid contact info (test tasks, incomplete data)
                    if (!contactName || contactName === 'Unknown Contact' || contactName === 'Unknown') {
                        console.log(`⏭️ Skipping task ${task.id} - no valid contact information`);
                        continue;
                    }
                    
                    // Try to fetch actual customer/lead name to ensure it's current
                    if (task.source === 'customer') {
                        try {
                            const customers = await base44.asServiceRole.entities.Customer.filter({ 
                                company_id: company.id 
                            });
                            const customer = customers.find(c => c.id === task.related_to || c.name === task.related_to);
                            if (customer) contactName = customer.name;
                        } catch (e) {
                            console.error('Failed to fetch customer:', e);
                        }
                    } else if (task.source === 'lead') {
                        try {
                            const leads = await base44.asServiceRole.entities.Lead.filter({ 
                                company_id: company.id 
                            });
                            const lead = leads.find(l => l.id === task.related_to || l.name === task.related_to);
                            if (lead) contactName = lead.name;
                        } catch (e) {
                            console.error('Failed to fetch lead:', e);
                        }
                    }

                    // 🔥 Check for duplicate notifications in last 12 hours
                    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
                    
                    // Send notifications and emails (with rate limiting)
                    let notificationCount = 0;
                    for (const email of notifyEmails) {
                        // Rate limiting: Add small delay every 3 notifications
                        if (notificationCount > 0 && notificationCount % 3 === 0) {
                            await sleep(300);
                        }

                        // Check if we already sent this user a reminder for this task today
                        const recentNotifications = await base44.asServiceRole.entities.Notification.filter({
                            company_id: company.id,
                            user_email: email,
                            type: 'task_reminder',
                            related_entity_id: task.id
                        });

                        const alreadyNotified = recentNotifications.some(n => 
                            n.created_date >= twelveHoursAgo
                        );

                        if (alreadyNotified) {
                            console.log(`⏭️ Skipping duplicate notification for ${email} on task ${task.id}`);
                            continue;
                        }

                        notificationCount++;
                        
                        // In-app notification
                        await base44.asServiceRole.entities.Notification.create({
                            company_id: company.id,
                            user_email: email,
                            title: `⚠️ Task Reminder: Follow up with ${contactName}`,
                            message: `Task is ${reminderReason}. Please follow up!`,
                            type: 'task_reminder',
                            related_entity_type: 'Task',
                            related_entity_id: task.id,
                            link_url: `/tasks?task_id=${task.id}`,
                            is_read: false
                        });

                        // Email reminder
                        try {
                            const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
                            const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
                            const taskUrl = `${appUrl}/tasks?task_id=${task.id}`;
                            
                            await resend.emails.send({
                                from: `${company.company_name || 'AI CRM Pro'} <noreply@mycrewcam.com>`,
                                to: email,
                                subject: `⚠️ Follow Up Needed: ${contactName} - ${task.name}`,
                                html: `
                                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                                            <h1 style="color: white; margin: 0; font-size: 24px;">⚠️ Task Needs Your Attention</h1>
                                        </div>
                                        
                                        <div style="background: white; padding: 30px; border: 2px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                                            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
                                                <p style="margin: 0; color: #92400e; font-size: 16px; font-weight: 600;">
                                                    📋 <strong>${task.name}</strong>
                                                </p>
                                                <p style="margin: 8px 0 0 0; color: #92400e; font-size: 14px;">
                                                    Has been ${reminderReason}
                                                </p>
                                            </div>

                                            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
                                                <table style="width: 100%; border-collapse: collapse;">
                                                    <tr>
                                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 40%;">👤 Customer:</td>
                                                        <td style="padding: 8px 0; font-weight: 600; font-size: 15px;">${contactName}</td>
                                                    </tr>
                                                    <tr>
                                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">📊 Status:</td>
                                                        <td style="padding: 8px 0; font-size: 14px;">${task.column.replace(/_/g, ' ').toUpperCase()}</td>
                                                    </tr>
                                                    ${task.due_date ? `
                                                    <tr>
                                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">📅 Due Date:</td>
                                                        <td style="padding: 8px 0; font-size: 14px; color: #dc2626; font-weight: 600;">${new Date(task.due_date).toLocaleDateString()}</td>
                                                    </tr>
                                                    ` : ''}
                                                    <tr>
                                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">🎯 Priority:</td>
                                                        <td style="padding: 8px 0;">
                                                            <span style="background: ${task.priority === 'high' ? '#fecaca' : task.priority === 'medium' ? '#fed7aa' : '#dbeafe'}; color: ${task.priority === 'high' ? '#991b1b' : task.priority === 'medium' ? '#9a3412' : '#1e40af'}; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                                                                ${task.priority || 'medium'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </div>

                                            <div style="text-align: center; margin: 30px 0;">
                                                <a href="${taskUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                                                    🔍 View Task & Take Action
                                                </a>
                                            </div>

                                            <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 24px;">
                                                <p style="margin: 0; font-size: 13px; color: #6b7280; line-height: 1.6;">
                                                    💡 <strong>Quick Tip:</strong> Click the button above to open this task directly in your CRM. You'll be able to update the status, add notes, and keep your customer informed.
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div style="text-align: center; margin-top: 20px;">
                                            <p style="font-size: 12px; color: #9ca3af; margin: 8px 0;">
                                                Sent from ${company.company_name || 'AI CRM Pro'}
                                            </p>
                                            <p style="font-size: 11px; color: #d1d5db; margin: 4px 0;">
                                                Link not working? ${taskUrl}
                                            </p>
                                        </div>
                                    </div>
                                `
                            });
                        } catch (emailError) {
                            console.error('Email send failed:', emailError);
                        }

                        // SMS for high priority tasks
                        if (task.priority === 'high') {
                            const staffProfile = allStaff.find(s => s.user_email === email);
                            if (staffProfile?.phone_number) {
                                try {
                                    await base44.asServiceRole.functions.invoke('sendSMS', {
                                        to: staffProfile.phone_number,
                                        message: `⚠️ URGENT: Task "${task.name}" is ${reminderReason}. Please follow up!`,
                                        contactName: staffProfile.full_name,
                                        companyId: company.id
                                    });
                                } catch (smsError) {
                                    console.error('SMS send failed:', smsError);
                                }
                            }
                        }
                    }

                    totalReminders++;

                    // Rate limiting: Add delay after processing each task with reminders
                    await sleep(200);
                    }
                    }
                    }

                    console.log(`✅ Processed ${companies.length} companies with rate limiting`);

        console.log(`✅ Task reminder check completed: ${totalReminders} reminders sent`);

        return Response.json({
            success: true,
            reminders_sent: totalReminders,
            message: `Processed task reminders for ${companies.length} companies`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Task reminder check error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});