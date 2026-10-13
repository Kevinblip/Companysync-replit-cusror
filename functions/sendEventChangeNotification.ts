import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { eventId, changeType, oldTime, newTime } = body;

        // Get the event details
        const event = await base44.asServiceRole.entities.CalendarEvent.get(eventId);
        if (!event) {
            return Response.json({ error: 'Event not found' }, { status: 404 });
        }

        // Get company settings for Twilio
        const companies = await base44.asServiceRole.entities.Company.filter({ 
            created_by: user.email 
        });
        
        let companyId = companies[0]?.id;
        
        if (!companyId) {
            const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
                user_email: user.email 
            });
            companyId = staffProfiles[0]?.company_id;
        }

        const results = {
            email: { sent: false, error: null },
            sms: { sent: false, error: null }
        };

        // 📧 Send email notification
        if (event.send_email_notification && user.email) {
            try {
                let emailSubject = '';
                let emailBody = '';

                if (changeType === 'created') {
                    emailSubject = `📅 New Event: ${event.title}`;
                    emailBody = `A new event has been scheduled:\n\n` +
                               `📅 ${event.title}\n` +
                               `🕐 ${newTime}\n` +
                               `📍 ${event.location || 'No location'}\n\n` +
                               `${event.description || ''}`;
                } else if (changeType === 'rescheduled') {
                    emailSubject = `📅 Event Rescheduled: ${event.title}`;
                    emailBody = `An event has been rescheduled:\n\n` +
                               `📅 ${event.title}\n\n` +
                               `Previous time: ${oldTime}\n` +
                               `New time: ${newTime}\n\n` +
                               `📍 ${event.location || 'No location'}\n\n` +
                               `${event.description || ''}`;
                } else if (changeType === 'deleted') {
                    emailSubject = `🗑️ Event Cancelled: ${event.title}`;
                    emailBody = `An event has been cancelled:\n\n` +
                               `📅 ${event.title}\n` +
                               `🕐 Was scheduled for: ${oldTime}\n\n` +
                               `${event.description || ''}`;
                }

                await base44.functions.invoke('sendUnifiedEmail', {
                    to: user.email,
                    subject: emailSubject,
                    html: emailBody.replace(/\n/g, '<br/>'),
                    companyId: companyId,
                    contactName: user.email.split('@')[0],
                    messageType: 'event_notification',
                    skipLogging: false,
                    skipNotification: true // Already triggered by the event change logic usually
                });

                results.email.sent = true;
                console.log(`✅ Email sent to ${user.email}`);
            } catch (emailError) {
                console.error('Email error:', emailError);
                results.email.error = emailError.message;
            }
        }

        // 📱 Send SMS notification
        if (event.send_sms_notification && companyId) {
            try {
                // Get user's phone number
                const userProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
                    user_email: user.email 
                });
                
                const userPhone = userProfiles[0]?.phone;

                if (userPhone) {
                    let smsMessage = '';

                    if (changeType === 'created') {
                        smsMessage = `📅 New Event: "${event.title}" scheduled for ${newTime}`;
                    } else if (changeType === 'rescheduled') {
                        smsMessage = `📅 Event Rescheduled: "${event.title}" moved from ${oldTime} to ${newTime}`;
                    } else if (changeType === 'deleted') {
                        smsMessage = `🗑️ Event Cancelled: "${event.title}" (was ${oldTime})`;
                    }

                    // Use existing sendSMS function
                    const smsResult = await base44.functions.invoke('sendSMS', {
                        to: userPhone,
                        message: smsMessage,
                        companyId: companyId
                    });

                    results.sms.sent = true;
                    console.log(`✅ SMS sent to ${userPhone}`);
                } else {
                    results.sms.error = 'No phone number found in user profile';
                }
            } catch (smsError) {
                console.error('SMS error:', smsError);
                results.sms.error = smsError.message;
            }
        }

        return Response.json({ 
            success: true,
            results: results
        });

    } catch (error) {
        console.error('Notification error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});