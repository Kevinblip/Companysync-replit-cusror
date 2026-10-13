
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

        // Detect whether the caller was unknown at the time of the call
        const isUnknownCaller = !communication.contact_name ||
            communication.contact_name === 'Voice Caller' ||
            communication.contact_name === 'Unknown Caller';

        console.log('📝 Analyzing transcription for:', contactName, isUnknownCaller ? '(unknown caller)' : '');

        // Cap transcription length sent to LLM (long calls)
        const MAX_CHARS = 12000;
        const transcriptForLLM = transcription.length > MAX_CHARS
            ? transcription.slice(0, MAX_CHARS / 2) + '\n...[middle truncated]...\n' + transcription.slice(-MAX_CHARS / 2)
            : transcription;

        // AI analysis of the call - Sarah persona
        const aiAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are Sarah, the AI assistant for CompanySync. You are reviewing a phone call recording for the team owner.

**Call Details:**
- Customer: ${contactName}
- Duration: ${duration || 0} seconds
- Transcription:
${transcriptForLLM}

**Provide a clear, conversational synopsis as if briefing the owner. Then extract:**
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

        // Build a clean Sarah-voice synopsis for the UI
        const synopsisLines = [];
        if (aiAnalysis.summary) synopsisLines.push(aiAnalysis.summary);
        if (aiAnalysis.intent) synopsisLines.push(`\n**Intent:** ${aiAnalysis.intent}`);
        if (aiAnalysis.key_points?.length) synopsisLines.push(`\n**Key points:**\n- ${aiAnalysis.key_points.join('\n- ')}`);
        if (aiAnalysis.action_items?.length) {
            synopsisLines.push(`\n**Action items:**\n- ${aiAnalysis.action_items.map(a => a.description).join('\n- ')}`);
        }
        if (aiAnalysis.issues_concerns?.length) synopsisLines.push(`\n**Concerns:** ${aiAnalysis.issues_concerns.join('; ')}`);

        // Append "Create Lead?" CTA for unknown callers so the owner can act directly from the call log
        if (isUnknownCaller) {
            const callerDisplay = fromNumber || 'this caller';
            synopsisLines.push(`\n\n---\n**📋 Create Lead?**\nThis caller (${callerDisplay}) was not found in your CRM. Consider creating a lead record to capture their information.`);
        }

        const sarahSynopsis = synopsisLines.join('\n');

        // Update the communication record with AI insights
        const nextActionValue = isUnknownCaller
            ? `Create a lead record for unknown caller (${fromNumber || 'unknown number'})`
            : aiAnalysis.summary;

        await base44.asServiceRole.entities.Communication.update(communication.id, {
            outcome: aiAnalysis.sentiment === 'positive' ? 'successful' :
                     aiAnalysis.sentiment === 'urgent' ? 'callback_requested' : 'completed',
            next_action: nextActionValue,
            ai_summary: sarahSynopsis,
            sentiment: aiAnalysis.sentiment,
            intent: aiAnalysis.intent
        });

        // Notify admins to create a lead when the caller was not in the CRM.
        // Only admins receive this — regular reps cannot create leads and should
        // not be interrupted by calls they didn't handle.
        if (isUnknownCaller) {
            try {
                const staffMembers = await base44.asServiceRole.entities.StaffProfile.filter({
                    company_id: companyId,
                    is_active: true
                });
                const admins = staffMembers.filter((s: any) => s.is_administrator);
                for (const staff of admins) {
                    await base44.asServiceRole.entities.Notification.create({
                        company_id: companyId,
                        user_email: staff.user_email,
                        title: '📋 Unknown Caller — Create Lead?',
                        message: `A call was received from ${fromNumber || 'an unknown number'} who is not in your CRM. Review the call and add them as a lead if appropriate.`,
                        type: 'general',
                        related_entity_type: 'Communication',
                        related_entity_id: communication.id,
                        link_url: '/communication',
                        is_read: false
                    });
                }
                console.log(`✅ Unknown-caller "Create Lead?" notifications sent to ${admins.length} admin(s)`);
            } catch (notifErr) {
                console.error('⚠️ Failed to send unknown-caller notification (non-critical):', notifErr);
            }
        }

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

                            // Scope to admins + the staff member assigned to this caller's record.
                            const adminEmails = new Set(
                                staffMembers
                                    .filter((s: any) => s.is_administrator)
                                    .map((s: any) => s.user_email)
                                    .filter(Boolean)
                            );
                            const assignedEmails = new Set<string>();

                            // 1. Check customer record linked to this communication
                            if (communication.customer_id) {
                                try {
                                    const customers = await base44.asServiceRole.entities.Customer.filter({ id: communication.customer_id });
                                    const customer = customers[0];
                                    if (customer?.assigned_to) assignedEmails.add(customer.assigned_to);
                                    if (Array.isArray(customer?.assigned_to_users)) {
                                        (customer.assigned_to_users as string[]).forEach((e: string) => assignedEmails.add(e));
                                    }
                                } catch (_) { /* non-critical */ }
                            }

                            // 2. Fall back to lead phone lookup
                            if (assignedEmails.size === 0 && fromNumber) {
                                try {
                                    const leads = await base44.asServiceRole.entities.Lead.filter({
                                        company_id: companyId,
                                        phone: fromNumber
                                    });
                                    const lead = leads[0];
                                    if (lead?.assigned_to) assignedEmails.add(lead.assigned_to);
                                    if (Array.isArray(lead?.assigned_to_users)) {
                                        (lead.assigned_to_users as string[]).forEach((e: string) => assignedEmails.add(e));
                                    }
                                } catch (_) { /* non-critical */ }
                            }

                            const recipientEmails = new Set([...adminEmails, ...assignedEmails]);
                            const recipients = staffMembers.filter((s: any) => recipientEmails.has(s.user_email));

                            for (const staff of recipients) {
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
                            console.log(`✅ CONFLICT alerts sent to ${recipients.length} staff (admins + assigned rep)`);

                            // 🆕 SEND TO GOOGLE CHAT (company master toggle must be on)
                            try {
                                const gcCoList = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                                if (gcCoList[0]?.settings?.google_chat_enabled === true) {
                                    const googleChatSettings = await base44.asServiceRole.entities.GoogleChatSettings.filter({
                                        company_id: companyId,
                                        send_conflict_alerts: true,
                                        is_active: true,
                                        integration_enabled: true
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
                                }
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

                // Scope alerts to admins + the specific staff member assigned to this caller's record.
                // Non-assigned reps have no business seeing another customer's urgent call details.
                const adminEmails = new Set(
                    staffMembers
                        .filter((s: any) => s.is_administrator)
                        .map((s: any) => s.user_email)
                        .filter(Boolean)
                );

                const assignedEmails = new Set<string>();

                // 1. Check customer record linked to this communication
                if (communication.customer_id) {
                    try {
                        const customers = await base44.asServiceRole.entities.Customer.filter({ id: communication.customer_id });
                        const customer = customers[0];
                        if (customer?.assigned_to) assignedEmails.add(customer.assigned_to);
                        if (Array.isArray(customer?.assigned_to_users)) {
                            (customer.assigned_to_users as string[]).forEach((e: string) => assignedEmails.add(e));
                        }
                    } catch (_) { /* non-critical — fall through */ }
                }

                // 2. Fall back to phone-number lookup on Lead (handles unknown callers too)
                if (assignedEmails.size === 0 && fromNumber) {
                    try {
                        const leads = await base44.asServiceRole.entities.Lead.filter({
                            company_id: companyId,
                            phone: fromNumber
                        });
                        const lead = leads[0];
                        if (lead?.assigned_to) assignedEmails.add(lead.assigned_to);
                        if (Array.isArray(lead?.assigned_to_users)) {
                            (lead.assigned_to_users as string[]).forEach((e: string) => assignedEmails.add(e));
                        }
                    } catch (_) { /* non-critical — fall through */ }
                }

                // Recipients = admins ∪ assigned staff, de-duped, verified against active staff
                const recipientEmails = new Set([...adminEmails, ...assignedEmails]);
                const recipients = staffMembers.filter((s: any) => recipientEmails.has(s.user_email));

                for (const staff of recipients) {
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
                console.log(`✅ Urgent notifications sent to ${recipients.length} staff (admins + assigned rep)`);
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
