
import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

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
        
        const { recordingUrl, callSid, fromNumber, toNumber, duration, companyId } = await req.json();
        
        console.log('🎙️ Processing call recording:', callSid);

        if (!companyId) {
            return Response.json({ error: 'Company ID required' }, { status: 400 });
        }

        // Fetch the recording transcription (if available)
        const communications = await base44.asServiceRole.entities.Communication.filter({
            twilio_sid: callSid,
            company_id: companyId
        });

        const communication = communications[0];
        
        if (!communication || !communication.transcription) {
            console.log('⚠️ No transcription found for call:', callSid);
            return Response.json({ 
                success: false, 
                message: 'No transcription available for this call' 
            });
        }

        const transcription = communication.transcription;
        const contactName = communication.contact_name || 'Unknown Caller';

        console.log('📝 Analyzing transcription for:', contactName);

        // AI analysis of the call
        const aiAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are Lexi, an AI assistant analyzing a customer phone call.

**Call Details:**
- Customer: ${contactName}
- Duration: ${duration || 0} seconds
- Transcription:
${transcription}

**Analyze this call and extract:**
1. **Intent**: What did the customer want? (appointment, question, complaint, follow-up, etc.)
2. **Sentiment**: Positive, neutral, negative, urgent
3. **Action Items**: Any tasks, appointments, or follow-ups needed?
4. **Key Points**: Main discussion points (max 3)
5. **Urgency**: Is this urgent? (true/false)
6. **Scheduling Request**: Did they request an appointment? Include proposed date/time if mentioned
7. **Issues/Concerns**: Any problems that need addressing?

Return structured JSON.`,
            response_json_schema: {
                type: "object",
                properties: {
                    intent: { type: "string" },
                    sentiment: { 
                        type: "string",
                        enum: ["positive", "neutral", "negative", "urgent"]
                    },
                    action_items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: { 
                                    type: "string",
                                    enum: ["task", "appointment", "follow_up", "reminder", "note"]
                                },
                                description: { type: "string" },
                                priority: {
                                    type: "string",
                                    enum: ["low", "medium", "high", "urgent"]
                                },
                                due_date: { type: "string" }
                            }
                        }
                    },
                    key_points: {
                        type: "array",
                        items: { type: "string" }
                    },
                    is_urgent: { type: "boolean" },
                    scheduling_request: {
                        type: "object",
                        properties: {
                            requested: { type: "boolean" },
                            proposed_date: { type: "string" },
                            proposed_time: { type: "string" },
                            service_type: { type: "string" }
                        }
                    },
                    issues_concerns: {
                        type: "array",
                        items: { type: "string" }
                    },
                    summary: { type: "string" }
                }
            }
        });

        console.log('✅ AI Analysis complete:', aiAnalysis);

        // Update the communication record with AI insights
        await base44.asServiceRole.entities.Communication.update(communication.id, {
            outcome: aiAnalysis.sentiment === 'positive' ? 'successful' : 
                     aiAnalysis.sentiment === 'urgent' ? 'callback_requested' : 'completed',
            next_action: aiAnalysis.summary,
            message: `${transcription}\n\n---AI ANALYSIS---\nIntent: ${aiAnalysis.intent}\nSentiment: ${aiAnalysis.sentiment}\nKey Points: ${aiAnalysis.key_points?.join(', ')}`
        });

        // Create tasks for action items
        const createdItems = [];
        
        if (aiAnalysis.action_items && aiAnalysis.action_items.length > 0) {
            for (const action of aiAnalysis.action_items) {
                if (action.type === 'task') {
                    const task = await base44.asServiceRole.entities.Task.create({
                        company_id: companyId,
                        name: `Follow-up: ${contactName} - ${action.description}`,
                        description: `From call on ${new Date().toLocaleDateString()}\n\nCall Summary: ${aiAnalysis.summary}\n\nAction: ${action.description}`,
                        status: 'not_started',
                        priority: action.priority || 'medium',
                        related_to: contactName,
                        source: 'customer',
                        due_date: action.due_date || null
                    });
                    createdItems.push({ type: 'task', id: task.id });
                    console.log('✅ Created task:', task.id);
                }

                if (action.type === 'appointment' && aiAnalysis.scheduling_request?.requested) {
                    // Try to parse the date
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
                            description: `Requested via phone call\n\nCall Summary: ${aiAnalysis.summary}${hasConflict ? '\n\n⚠️ CALENDAR CONFLICT DETECTED - Please review!' : ''}`,
                            start_time: appointmentDate.toISOString(),
                            end_time: appointmentEndTime.toISOString(),
                            event_type: 'appointment',
                            status: 'scheduled',
                            related_customer: contactName,
                            color: hasConflict ? '#ef4444' : '#10b981' // Red if conflict, green if no conflict
                        });
                        createdItems.push({ type: 'appointment', id: event.id, hasConflict });
                        console.log(`✅ Created appointment: ${event.id}${hasConflict ? ' (WITH CONFLICT)' : ''}`);

                        // 🆕 SEND CONFLICT NOTIFICATION WITH AUDIO ALERT FLAG
                        if (hasConflict) {
                            const staffMembers = await base44.asServiceRole.entities.StaffProfile.filter({ 
                                company_id: companyId,
                                is_active: true 
                            });

                            for (const staff of staffMembers) {
                                await base44.asServiceRole.entities.Notification.create({
                                    company_id: companyId,
                                    user_email: staff.user_email,
                                    title: '🔴 SCHEDULING CONFLICT - Call Customer Back!',
                                    message: `${contactName} requested appointment on ${appointmentDate.toLocaleDateString()} at ${appointmentDate.toLocaleTimeString()}, but ${conflicts.length} existing event(s) overlap. Call them back to reschedule!`,
                                    type: 'general',
                                    related_entity_type: 'CalendarEvent',
                                    related_entity_id: event.id,
                                    link_url: '/calendar',
                                    is_read: false
                                });
                            }
                            console.log('✅ CONFLICT alerts sent to all staff');

                            // 🆕 SEND TO GOOGLE CHAT
                            try {
                                const googleChatSettings = await base44.asServiceRole.entities.GoogleChatSettings.filter({
                                    company_id: companyId,
                                    send_conflict_alerts: true,
                                    is_active: true
                                });

                                for (const chatWebhook of googleChatSettings) {
                                    await base44.asServiceRole.functions.invoke('sendGoogleChatMessage', {
                                        message: `🔴 SCHEDULING CONFLICT - CALL CUSTOMER BACK!\n\n${contactName} requested appointment on ${appointmentDate.toLocaleDateString()} at ${appointmentDate.toLocaleTimeString()}\n\n⚠️ ${conflicts.length} existing event(s) overlap!\n\nAction: Call them back immediately to reschedule`,
                                        webhookUrl: chatWebhook.webhook_url,
                                        companyId: companyId,
                                        cardTitle: '🔴 Calendar Conflict - Phone Call',
                                        cardSubtitle: `Customer: ${contactName}`
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

        // Create notifications for urgent items
        if (aiAnalysis.is_urgent || aiAnalysis.sentiment === 'urgent' || 
            aiAnalysis.issues_concerns?.length > 0) {
            
            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const company = companies[0];
            
            if (company) {
                const staffMembers = await base44.asServiceRole.entities.StaffProfile.filter({ 
                    company_id: companyId,
                    is_active: true 
                });

                for (const staff of staffMembers) {
                    await base44.asServiceRole.entities.Notification.create({
                        company_id: companyId,
                        user_email: staff.user_email,
                        title: '🚨 Urgent Call Requires Attention',
                        message: `${contactName}: ${aiAnalysis.summary || 'Call needs immediate follow-up'}`,
                        type: 'general',
                        related_entity_type: 'Communication',
                        related_entity_id: communication.id,
                        link_url: '/communication',
                        is_read: false
                    });
                }
                console.log('✅ Urgent notifications sent to staff');
            }
        }

        return Response.json({
            success: true,
            analysis: aiAnalysis,
            items_created: createdItems,
            call_summary: aiAnalysis.summary
        });

    } catch (error) {
        console.error('❌ Call processing error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});
