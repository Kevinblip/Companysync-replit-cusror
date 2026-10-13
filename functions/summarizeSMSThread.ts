import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Generates a Sarah-voice synopsis of an entire SMS conversation with one contact.
// Body: { companyId, contactPhone }
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { companyId, contactPhone } = await req.json();
        if (!companyId || !contactPhone) {
            return Response.json({ error: 'companyId and contactPhone required' }, { status: 400 });
        }

        // 🔒 Company-level access check (must run BEFORE any settings lookup
        // so we don't leak per-company configuration to unauthorized callers)
        const isSuperAdmin = user.platform_role === 'super_admin';
        if (!isSuperAdmin) {
            const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const isOwner = company?.length > 0 && company[0].created_by === user.email;
            const staff = await base44.asServiceRole.entities.StaffProfile.filter({
                user_email: user.email, company_id: companyId
            });
            const isStaff = staff && staff.length > 0;
            if (!isOwner && !isStaff) {
                console.error(`⛔ ACCESS DENIED: ${user.email} tried to summarize SMS for company ${companyId}`);
                return Response.json({ error: 'Forbidden: no access to this company' }, { status: 403 });
            }
        }

        // Honor admin toggle: allow disabling SMS summaries to save on LLM costs
        const twilioSettingsRows = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
        const twilioSettings = twilioSettingsRows?.[0];
        if (twilioSettings && twilioSettings.enable_sms_auto_summary === false) {
            return Response.json({ error: 'SMS auto-summary is disabled in Twilio Setup' }, { status: 403 });
        }

        // Fetch all SMS for this contact
        const normalize = (p) => (p || '').replace(/\D/g, '').slice(-10);
        const target = normalize(contactPhone);

        const allSms = await base44.asServiceRole.entities.Communication.filter({
            company_id: companyId,
            communication_type: 'sms'
        });
        const thread = allSms
            .filter(s => normalize(s.contact_phone) === target)
            .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

        if (thread.length === 0) {
            return Response.json({ error: 'No SMS found for this contact' }, { status: 404 });
        }

        // Build conversation log (cap to last 60 messages for token budget)
        const recent = thread.slice(-60);
        const log = recent.map(m => {
            const who = m.direction === 'inbound' ? 'Customer' : 'Us';
            const text = m.message || m.body || '';
            const t = m.created_date ? new Date(m.created_date).toLocaleString() : '';
            return `[${t}] ${who}: ${text}`;
        }).join('\n');

        const analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are Sarah, the AI assistant for CompanySync. Summarize this SMS conversation for the team owner.

Contact: ${recent[0].contact_name || 'Unknown'} (${contactPhone})
Total messages in thread: ${thread.length} (showing most recent ${recent.length})

CONVERSATION:
${log}

Provide a brief, conversational synopsis (2-4 sentences) covering: what the customer wants, where things stand right now, and any open questions or action items.`,
            response_json_schema: {
                type: 'object',
                properties: {
                    summary: { type: 'string' },
                    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'urgent'] },
                    open_action_items: { type: 'array', items: { type: 'string' } },
                    last_message_from: { type: 'string', enum: ['customer', 'us'] }
                }
            }
        });

        const lines = [];
        if (analysis.summary) lines.push(analysis.summary);
        if (analysis.open_action_items?.length) {
            lines.push(`\n**Open items:**\n- ${analysis.open_action_items.join('\n- ')}`);
        }
        const synopsis = lines.join('\n');

        // Save synopsis to the most recent message in the thread
        const latest = thread[thread.length - 1];
        await base44.asServiceRole.entities.Communication.update(latest.id, {
            ai_summary: synopsis,
            sentiment: analysis.sentiment
        });

        return Response.json({
            success: true,
            synopsis,
            sentiment: analysis.sentiment,
            messageCount: thread.length,
            updatedCommunicationId: latest.id
        });

    } catch (error) {
        console.error('❌ summarizeSMSThread error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
