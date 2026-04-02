} minutes used`);
                return jsonResponse({ success: true, minutes_tracked: durationMinutes, total_used: newTotal });
            }

            case 'getTwilioConfig': {
                if (!companyId) {
                    return jsonResponse({ error: 'Missing companyId' }, 400);
                }
                const twilioRows5 = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
                const twilioConfig5: any = twilioRows5[0];
                if (!twilioConfig5) {
                    return jsonResponse({ error: 'Twilio not configured' }, 400);
                }
                return jsonResponse({
                    account_sid: twilioConfig5.account_sid,
                    auth_token: twilioConfig5.auth_token,
                    main_phone_number: twilioConfig5.main_phone_number,
                });
            }

            case 'initiateOutboundCall': {
                if (!companyId || !data?.leadPhone) {
                    return jsonResponse({ error: 'Missing companyId or data.leadPhone' }, 400);
                }

                const twilioRows3 = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
                const twilioConfig3: any = twilioRows3[0];
                if (!twilioConfig3 || !twilioConfig3.account_sid || !twilioConfig3.auth_token || !twilioConfig3.main_phone_number) {
                    return jsonResponse({ error: 'Twilio not configured for this company' }, 400);
                }

                const settingsRows3 = await base44.asServiceRole.entities.AssistantSettings.filter({ company_id: companyId }, '-updated_date', 1);
                const assistSettings: any = settingsRows3[0] || {};
                const outboundEnabled = assistSettings.outbound_calls_enabled !== false;
                if (!outboundEnabled) {
                    return jsonResponse({ error: 'Outbound calls are disabled for this company' }, 403);
                }

                const appUrl = Deno.env.get('APP_URL') || '';
                if (!appUrl) {
                    return jsonResponse({ error: 'APP_URL not configured. Cannot initiate outbound calls.' }, 500);
                }

                // Truncate basic lead info
                const leadPhone = data.leadPhone;
                const leadName = (data.leadName || '').substring(0, 50);
                const leadService = (data.leadService || '').substring(0, 50);
                const leadAddress = (data.leadAddress || '').substring(0, 100);
                const campaignId = data.campaignId || '';
                const maxDuration = 600;
                const introScript = (data.introScript || '').substring(0, 500);
                const talkingPoints = (data.talkingPoints || '').substring(0, 500);
                const callGoals = (data.callGoals || '').substring(0, 300);

                const cleanTo = leadPhone.replace(/[^\d+]/g, '');
                const cleanFrom = twilioConfig3.main_phone_number.replace(/[^\d+]/g, '');
                const toNumber = cleanTo.startsWith('+') ? cleanTo : `+1${cleanTo}`;
                const fromNumber = cleanFrom.startsWith('+') ? cleanFrom : `+1${cleanFrom}`;

                const twimlUrl = `${appUrl}/twiml/outbound?companyId=${encodeURIComponent(companyId)}&leadPhone=${encodeURIComponent(leadPhone)}&leadName=${encodeURIComponent(leadName)}&leadService=${encodeURIComponent(leadService)}&leadAddress=${encodeURIComponent(leadAddress)}&maxDuration=${maxDuration}&campaignId=${encodeURIComponent(campaignId)}&introScript=${encodeURIComponent(introScript)}&talkingPoints=${encodeURIComponent(talkingPoints)}&callGoals=${encodeURIComponent(callGoals)}`;
                const statusCallback = `${appUrl}/api/sarah-call-status`;

                const authStr = btoa(`${twilioConfig3.account_sid}:${twilioConfig3.auth_token}`);
                const callParams = new URLSearchParams({
                    To: toNumber,
                    From: fromNumber,
                    Url: twimlUrl,
                    StatusCallback: statusCallback,
                    StatusCallbackEvent: 'initiated ringing answered completed',
                    StatusCallbackMethod: 'POST',
                    Timeout: '30',
                    MachineDetection: 'Enable',
                    MachineDetectionTimeout: '5',
                });

                console.log(`[initiateOutboundCall] Calling Twilio: to=${toNumber}, from=${fromNumber}, company=${companyId}`);

                const twilioResp = await fetch(
                    `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig3.account_sid}/Calls.json`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${authStr}`,
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: callParams.toString(),
                    }
                );

                const twilioResult = await twilioResp.json();
                if (!twilioResp.ok) {
                    console.error(`[initiateOutboundCall] Twilio error:`, JSON.stringify(twilioResult));
                    return jsonResponse({ error: twilioResult.message || 'Twilio call failed' }, 400);
                }

                console.log(`[initiateOutboundCall] Call created: SID=${twilioResult.sid}, status=${twilioResult.status}`);

                try {
                    await base44.asServiceRole.entities.Communication.create({
                        company_id: companyId,
                        contact_phone: leadPhone,
                        contact_name: leadName,
                        communication_type: 'call',
                        direction: 'outbound',
                        message: `Outbound call initiated to ${leadName || leadPhone}. Service: ${leadService || 'N/A'}`,
                        status: 'initiated',
                        call_sid: twilioResult.sid,
                    });
                } catch (logErr: any) {
                    console.warn('[initiateOutboundCall] Failed to log call:', logErr.message);
                }

                return jsonResponse({
                    success: true,
                    message: `Outbound call initiated to ${leadPhone}`,
                    callSid: twilioResult.sid,
                    status: twilioResult.status,
                });
            }

            case 'sendFollowUpSMS': {
                if (!companyId || !data?.phone || !data?.message) {
                    return jsonResponse({ error: 'Missing companyId, data.phone, or data.message' }, 400);
                }

                const twilioRows4 = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
                const twilioConfig4: any = twilioRows4[0];
                if (!twilioConfig4 || !twilioConfig4.account_sid || !twilioConfig4.auth_token || !twilioConfig4.main_phone_number) {
                    return jsonResponse({ error: 'Twilio not configured' }, 400);
                }

                const cleanPhone = data.phone.replace(/[^\d+]/g, '');
                const toNum = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;
                const fromNum = twilioConfig4.main_phone_number.startsWith('+') ? twilioConfig4.main_phone_number : `+1${twilioConfig4.main_phone_number.replace(/\D/g, '')}`;

                const smsAuthStr = btoa(`${twilioConfig4.account_sid}:${twilioConfig4.auth_token}`);
                const smsParams = new URLSearchParams({
                    To: toNum,
                    From: fromNum,
                    Body: data.message,
                });

                const smsResp = await fetch(
                    `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig4.account_sid}/Messages.json`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${smsAuthStr}`,
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: smsParams.toString(),
                    }
                );

                const smsData = await smsResp.json();
                if (!smsResp.ok) {
                    return jsonResponse({ error: smsData.message || 'SMS send failed' }, 400);
                }

                await base44.asServiceRole.entities.Communication.create({
                    company_id: companyId,
                    contact_name: data.contactName || 'Lead',
                    contact_phone: data.phone,
                    communication_type: 'sms',
                    direction: 'outbound',
                    subject: 'Follow-up SMS',
                    message: data.message,
                    twilio_sid: smsData.sid,
                    status: 'sent',
                });

                return jsonResponse({ success: true, message: 'SMS sent', messageSid: smsData.sid });
            }

            case 'getOutboundSettings': {
                if (!companyId) {
                    return jsonResponse({ error: 'Missing companyId' }, 400);
                }

                const settingsRows4 = await base44.asServiceRole.entities.AssistantSettings.filter({ company_id: companyId }, '-updated_date', 1);
                const settings4: any = settingsRows4[0] || {};

                return jsonResponse({
                    outbound_calls_enabled: settings4.outbound_calls_enabled ?? false,
                    inbound_calls_enabled: settings4.inbound_calls_enabled ?? true,
                    auto_call_new_leads: settings4.auto_call_new_leads ?? false,
                    auto_call_delay_minutes: settings4.auto_call_delay_minutes ?? 5,
                    outbound_greeting: settings4.outbound_greeting || '',
                    business_hours_start: settings4.scheduling_defaults?.business_hours_start ?? 9,
                    business_hours_end: settings4.scheduling_defaults?.business_hours_end ?? 17,
                    send_sms_after_booking: settings4.send_sms_after_booking ?? true,
                });
            }

            default:
                return jsonResponse({ error: `Unknown action: ${action}` }, 400);
        }
    } catch (error: any) {
        console.error('[sarahBridgeAPI] Error:', error);
        return jsonResponse({ error: error.message || 'Internal server error' }, 500);
    }
});
