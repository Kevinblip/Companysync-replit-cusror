import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// 🆕 CHECK FOR CALENDAR CONFLICTS
async function checkCalendarConflict(base44, companyId, proposedStartTime, proposedEndTime) {
    const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ 
        company_id: companyId,
        status: 'scheduled'
    });

    const proposedStart = new Date(proposedStartTime);
    const proposedEnd = new Date(proposedEndTime);

    const conflicts = allEvents.filter(event => {
        const eventStart = new Date(event.start_time);
        const eventEnd = new Date(event.end_time);

        // Check if times overlap
        return (proposedStart < eventEnd && proposedEnd > eventStart);
    });

    return conflicts;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const { emailSubject, emailBody, fromEmail, fromName, companyId } = await req.json();
        
        console.log('📧 Processing email from:', fromEmail);

        if (!companyId) {
            return Response.json({ error: 'Company ID required' }, { status: 400 });
        }

        // Find the sender in customers or leads
        const customers = await base44.asServiceRole.entities.Customer.filter({ 
            company_id: companyId 
        });
        const leads = await base44.asServiceRole.entities.Lead.filter({ 
            company_id: companyId 
        });

        let contactName = fromName || 'Unknown Sender';
        let contactId = null;
        let contactType = null;

        const customer = customers.find(c => c.email?.toLowerCase() === fromEmail?.toLowerCase());
        const lead = leads.find(l => l.email?.toLowerCase() === fromEmail?.toLowerCase());

        if (customer) {
            contactName = customer.name;
            contactId = customer.id;
            contactType = 'Customer';
        } else if (lead) {
            contactName = lead.name;
            contactId = lead.id;
            contactType = 'Lead';
        }

        console.log('📝 Analyzing email from:', contactName);

        // AI analysis of the email
        const aiAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are Lexi, an AI assistant analyzing a customer email.

**Email Details:**
- From: ${contactName} (${fromEmail})
- Subject: ${emailSubject}
- Body:
${emailBody}

**Analyze this email and extract:**
1. **Intent**: What does the customer want? (question, appointment_request, complaint, payment_issue, estimate_request, follow_up, etc.)
2. **Sentiment**: positive, neutral, negative, urgent
3. **Priority**: low, medium, high, urgent
4. **Action Items**: Any tasks, appointments, or follow-ups needed?
5. **Scheduling Request**: Did they request a meeting/appointment? Include date/time if mentioned
6. **Questions Asked**: List any questions that need answering
7. **Issues/Concerns**: Any problems mentioned?
8. **Requires Response**: Does this email need a reply? (true/false)

Return structured JSON.`,
            response_json_schema: {
                type: "object",
                properties: {
                    intent: { type: "string" },
                    sentiment: { 
                        type: "string",
                        enum: ["positive", "neutral", "negative", "urgent"]
                    },
                    priority: {
                        type: "string",
                        enum: ["low", "medium", "high", "urgent"]
                    },
                    action_items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: { 
                                    type: "string",
                                    enum: ["task", "appointment", "follow_up", "reminder"]
                                },
                                description: { type: "string" },
                                due_date: { type: "string" }
                            }
                        }
                    },
                    scheduling_request: {
                        type: "object",
                        properties: {
                            requested: { type: "boolean" },
                            proposed_date: { type: "string" },
                            proposed_time: { type: "string" },
                            service_type: { type: "string" }
                        }
                    },
                    questions_asked: {
                        type: "array",
                        items: { type: "string" }
                    },
                    issues_concerns: {
                        type: "array",
                        items: { type: "string" }
                    },
                    requires_response: { type: "boolean" },
                    suggested_response: { type: "string" },
                    summary: { type: "string" }
                }
            }
        });

        console.log('✅ AI Analysis complete:', aiAnalysis);

        // Log the email as a communication
        const commRecord = await base44.asServiceRole.entities.Communication.create({
            company_id: companyId,
            contact_name: contactName,
            contact_email: fromEmail,
            communication_type: 'email',
            direction: 'inbound',
            subject: emailSubject,
            message: emailBody,
            status: 'delivered',
            outcome: aiAnalysis.requires_response ? 'follow_up_needed' : 'completed',
            next_action: aiAnalysis.summary
        });

        console.log('✅ Email logged:', commRecord.id);

        // Create tasks for action items
        const createdItems = [];
        
        if (aiAnalysis.action_items && aiAnalysis.action_items.length > 0) {
            for (const action of aiAnalysis.action_items) {
                if (action.type === 'task' || action.type === 'follow_up') {
                    const task = await base44.asServiceRole.entities.Task.create({
                        company_id: companyId,
                        name: `Email: ${contactName} - ${action.description}`,
                        description: `From email: ${emailSubject}\n\nSummary: ${aiAnalysis.summary}\n\nAction: ${action.description}`,
                        status: 'not_started',
                        priority: aiAnalysis.priority || 'medium',
                        related_to: contactName,
                        source: 'customer',
                        due_date: action.due_date || null
                    });
                    createdItems.push({ type: 'task', id: task.id });
                    console.log('✅ Created task:', task.id);
                }

                if (action.type === 'appointment' && aiAnalysis.scheduling_request?.requested) {
                    let appointmentDate = null;
                    if (aiAnalysis.scheduling_request.proposed_date) {
                        appointmentDate = new Date(aiAnalysis.scheduling_request.proposed_date);
                    }

                    if (appointmentDate && !isNaN(appointmentDate.getTime())) {
                        const appointmentEndTime = new Date(appointmentDate.getTime() + 60 * 60 * 1000);

                        // 🆕 CHECK FOR CONFLICTS
                        const conflicts = await checkCalendarConflict(
                            base44, 
                            companyId, 
                            appointmentDate.toISOString(), 
                            appointmentEndTime.toISOString()
                        );

                        const hasConflict = conflicts.length > 0;
                        console.log(`📅 Conflict check: ${conflicts.length} conflict(s) found`);

                        const event = await base44.asServiceRole.entities.CalendarEvent.create({
                            company_id: companyId,
                            title: `${aiAnalysis.scheduling_request.service_type || 'Appointment'} - ${contactName}`,
                            description: `Requested via email: ${emailSubject}\n\nSummary: ${aiAnalysis.summary}${hasConflict ? '\n\n⚠️ CALENDAR CONFLICT DETECTED - Please review!' : ''}`,
                            start_time: appointmentDate.toISOString(),
                            end_time: appointmentEndTime.toISOString(),
                            event_type: 'appointment',
                            status: 'scheduled',
                            related_customer: contactName,
                            color: hasConflict ? '#ef4444' : '#8b5cf6' // Red if conflict, purple if no conflict
                        });
                        createdItems.push({ type: 'appointment', id: event.id, hasConflict });
                        console.log(`✅ Created appointment: ${event.id}${hasConflict ? ' (WITH CONFLICT)' : ''}`);

                        // 🆕 SEND CONFLICT NOTIFICATION
                        if (hasConflict) {
                            const staffMembers = await base44.asServiceRole.entities.StaffProfile.filter({ 
                                company_id: companyId,
                                is_active: true 
                            });

                            for (const staff of staffMembers) {
                                await base44.asServiceRole.entities.Notification.create({
                                    company_id: companyId,
                                    user_email: staff.user_email,
                                    title: '⚠️ SCHEDULING CONFLICT ALERT',
                                    message: `${contactName} requested appointment on ${appointmentDate.toLocaleDateString()} at ${appointmentDate.toLocaleTimeString()}, but ${conflicts.length} existing event(s) overlap. Review calendar immediately!`,
                                    type: 'general',
                                    related_entity_type: 'CalendarEvent',
                                    related_entity_id: event.id,
                                    link_url: '/calendar',
                                    is_read: false
                                });
                            }
                            console.log('✅ Conflict alerts sent to all staff');

                            // 🆕 SEND TO GOOGLE CHAT
                            try {
                                const googleChatSettings = await base44.asServiceRole.entities.GoogleChatSettings.filter({
                                    company_id: companyId,
                                    send_conflict_alerts: true,
                                    is_active: true
                                });

                                for (const chatWebhook of googleChatSettings) {
                                    await base44.asServiceRole.functions.invoke('sendGoogleChatMessage', {
                                        message: `🔴 SCHEDULING CONFLICT\n\n${contactName} requested appointment on ${appointmentDate.toLocaleDateString()} at ${appointmentDate.toLocaleTimeString()}\n\n⚠️ ${conflicts.length} existing event(s) overlap!\n\nAction needed: Call customer to reschedule`,
                                        webhookUrl: chatWebhook.webhook_url,
                                        companyId: companyId,
                                        cardTitle: '⚠️ Calendar Conflict Alert',
                                        cardSubtitle: `From email - ${fromEmail}`
                                    });
                                }
                                console.log('✅ Google Chat conflict alert sent');
                            } catch (gcError) {
                                console.error('⚠️ Google Chat notification failed (non-critical):', gcError);
                            }
                        }
                    }
                }
            }
        }

        // Create notifications for urgent/high priority emails
        if (aiAnalysis.priority === 'urgent' || aiAnalysis.priority === 'high' || 
            aiAnalysis.sentiment === 'urgent' || aiAnalysis.issues_concerns?.length > 0) {
            
            const staffMembers = await base44.asServiceRole.entities.StaffProfile.filter({ 
                company_id: companyId,
                is_active: true 
            });

            const notificationTitle = aiAnalysis.priority === 'urgent' 
                ? '🚨 Urgent Email Needs Response'
                : '⚠️ Important Email Received';

            for (const staff of staffMembers) {
                await base44.asServiceRole.entities.Notification.create({
                    company_id: companyId,
                    user_email: staff.user_email,
                    title: notificationTitle,
                    message: `${contactName}: ${aiAnalysis.summary || emailSubject}`,
                    type: 'general',
                    related_entity_type: 'Communication',
                    related_entity_id: commRecord.id,
                    link_url: '/communication',
                    is_read: false
                });
            }
            console.log('✅ Priority notifications sent to staff');
        }

        return Response.json({
            success: true,
            analysis: aiAnalysis,
            items_created: createdItems,
            communication_id: commRecord.id,
            summary: aiAnalysis.summary
        });

    } catch (error) {
        console.error('❌ Email processing error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});