import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function jsonResponse(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const cronSecret = req.headers.get('X-Cron-Secret');
        const expectedSecret = Deno.env.get('CRON_SECRET_TOKEN');

        if (!expectedSecret || cronSecret !== expectedSecret) {
            const base44 = createClientFromRequest(req);
            const authHeader = req.headers.get('Authorization');
            const bridgeSecret = Deno.env.get('SARAH_BRIDGE_SECRET');
            if (!bridgeSecret || authHeader !== `Bearer ${bridgeSecret}`) {
                return jsonResponse({ error: 'Unauthorized' }, 401);
            }
        }

        const base44 = createClientFromRequest(req);
        const appUrl = Deno.env.get('APP_URL') || '';
        const bridgeSecret = Deno.env.get('SARAH_BRIDGE_SECRET') || '';
        const bridgeApiUrl = Deno.env.get('BASE44_SARAH_API_URL') || '';

        if (!appUrl) {
            return jsonResponse({ error: 'APP_URL not configured' }, 500);
        }

        const allSettings = await base44.asServiceRole.entities.AssistantSettings.filter({}, '-updated_date', 500);
        const autoCallCompanies = allSettings.filter((s: any) =>
            s.outbound_calls_enabled && s.auto_call_new_leads && s.company_id
        );

        console.log(`[autoCallNewLeads] Found ${autoCallCompanies.length} companies with auto-call enabled`);

        const results: any[] = [];

        for (const settings of autoCallCompanies) {
            const companyId = settings.company_id;
            const delayMinutes = (settings as any).auto_call_delay_minutes || 5;

            try {
                const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                const company = companies[0];
                if (!company) continue;

                const tz = company.timezone || 'America/New_York';
                const bizStart = settings.scheduling_defaults?.business_hours_start ?? 9;
                const bizEnd = settings.scheduling_defaults?.business_hours_end ?? 17;

                const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz });
                const localHour = new Date(nowLocal).getHours();
                const localDay = new Date(nowLocal).getDay();

                if (localDay === 0 || localDay === 6 || localHour < bizStart || localHour >= bizEnd) {
                    console.log(`[autoCallNewLeads] Company ${companyId}: Outside business hours, skipping`);
                    continue;
                }

                const cutoffTime = new Date(Date.now() - delayMinutes * 60 * 1000).toISOString();
                const maxAge = new Date(Date.now() - 60 * 60 * 1000).toISOString();

                const leads = await base44.asServiceRole.entities.Lead.filter({
                    company_id: companyId,
                    status: 'new',
                }, '-created_date', 20);

                const eligibleLeads = leads.filter((lead: any) => {
                    if (!lead.phone) return false;
                    if (!lead.created_date) return false;
                    const createdAt = new Date(lead.created_date).toISOString();
                    return createdAt <= cutoffTime && createdAt >= maxAge;
                });

                console.log(`[autoCallNewLeads] Company ${companyId}: ${eligibleLeads.length} eligible leads (of ${leads.length} new leads)`);

                for (const lead of eligibleLeads) {
                    const comms = await base44.asServiceRole.entities.Communication.filter({
                        company_id: companyId,
                        contact_phone: lead.phone,
                        direction: 'outbound',
                        communication_type: 'call',
                    });

                    if (comms.length > 0) {
                        console.log(`[autoCallNewLeads] Lead ${lead.id} already called, skipping`);
                        continue;
                    }

                    try {
                        const callResp = await fetch(bridgeApiUrl || `${appUrl}/api/sarah-bridge`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${bridgeSecret}`,
                            },
                            body: JSON.stringify({
                                action: 'initiateOutboundCall',
                                companyId,
                                data: {
                                    leadPhone: lead.phone,
                                    leadName: lead.name || '',
                                    leadService: lead.notes?.match(/Service: (.+)/)?.[1] || '',
                                    leadAddress: lead.street || '',
                                },
                            }),
                        });

                        const callResult = await callResp.json();

                        if (callResult.success) {
                            await base44.asServiceRole.entities.Lead.update(lead.id, {
                                status: 'contacted',
                                notes: (lead.notes || '') + `\n[Auto-call initiated ${new Date().toLocaleString('en-US', { timeZone: tz })}]`,
                            });

                            results.push({
                                companyId,
                                leadId: lead.id,
                                leadName: lead.name,
                                phone: lead.phone,
                                callSid: callResult.callSid,
                                status: 'call_initiated',
                            });
                        } else {
                            results.push({
                                companyId,
                                leadId: lead.id,
                                error: callResult.error,
                                status: 'failed',
                            });
                        }
                    } catch (callErr: any) {
                        console.error(`[autoCallNewLeads] Call failed for lead ${lead.id}:`, callErr.message);
                        results.push({ companyId, leadId: lead.id, error: callErr.message, status: 'error' });
                    }
                }
            } catch (compErr: any) {
                console.error(`[autoCallNewLeads] Error processing company ${companyId}:`, compErr.message);
            }
        }

        return jsonResponse({
            success: true,
            companies_checked: autoCallCompanies.length,
            calls_initiated: results.filter(r => r.status === 'call_initiated').length,
            results,
        });
    } catch (error: any) {
        console.error('[autoCallNewLeads] Error:', error);
        return jsonResponse({ error: error.message || 'Internal server error' }, 500);
    }
});
