import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
/* TRIAL_POLICY_START */
const NEW_COMPANY_TRIAL_MS = 14 * 24 * 60 * 60 * 1000;
const PROTECTED_SUBSCRIPTION_STATUSES = new Set(['active', 'past_due', 'cancelled', 'canceled', 'expired', 'suspended', 'unpaid']);
const KNOWN_PAID_PLANS = new Set(['basic', 'business', 'enterprise', 'professional', 'starter', 'freelance']);

function snippetParseData(company) {
  if (!company || !company.data) return {};
  if (typeof company.data === 'string') {
    try { const parsed = JSON.parse(company.data); return parsed && typeof parsed === 'object' ? parsed : {}; }
    catch { return {}; }
  }
  return typeof company.data === 'object' ? company.data : {};
}
function snippetFirstTimestamp(values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}
function snippetReadStoredTrialEnd(company) {
  if (!company) return null;
  const data = snippetParseData(company);
  return snippetFirstTimestamp([company.trial_ends_at, company.trial_end_date, data.trial_ends_at, data.trial_end_date]);
}
function snippetReadStatus(company) {
  if (!company) return '';
  const data = snippetParseData(company);
  return String(company.subscription_status || data.subscription_status || '').trim().toLowerCase();
}
function snippetReadPlan(company) {
  if (!company) return '';
  const data = snippetParseData(company);
  return String(company.subscription_plan || data.subscription_plan || '').trim().toLowerCase();
}
function snippetReadStripeId(company) {
  if (!company) return '';
  const data = snippetParseData(company);
  return String(company.stripe_subscription_id || data.stripe_subscription_id || '').trim();
}
function newCompanyTrialRecord(now = new Date()) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const iso = new Date(start.getTime() + NEW_COMPANY_TRIAL_MS).toISOString();
  return { trialDays: 14, requiresCard: false, startedAt: start.toISOString(), trial_ends_at: iso, trial_end_date: iso, subscription_status: 'trial' };
}
function planSubscriptionCheckoutTrial(company, metadata = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const stored = snippetReadStoredTrialEnd(company);
  const status = snippetReadStatus(company);
  if (PROTECTED_SUBSCRIPTION_STATUSES.has(status)) {
    return { action: 'no_trial_on_existing_subscription', trial_period_days: null, trial_end: null, storedTrialEnd: stored };
  }
  if (stored) {
    const storedMs = new Date(stored).getTime();
    if (storedMs > nowDate.getTime()) {
      return { action: 'preserve_stored_end', trial_period_days: null, trial_end: Math.floor(storedMs / 1000), storedTrialEnd: stored };
    }
    return { action: 'preserve_expired_end', trial_period_days: null, trial_end: null, storedTrialEnd: stored };
  }
  if (KNOWN_PAID_PLANS.has(snippetReadPlan(company)) || snippetReadStripeId(company)) {
    return { action: 'no_trial_on_existing_subscription', trial_period_days: null, trial_end: null, storedTrialEnd: null };
  }
  const extend = String(metadata?.extend_trial ?? '') === '7';
  const days = extend ? 21 : 14;
  return {
    action: extend ? 'existing_card_bonus_offer' : 'new_trial',
    trial_period_days: days,
    trial_end: null,
    proposedTrialEnd: new Date(nowDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    storedTrialEnd: null,
  };
}
function applyCheckoutTrial(sessionConfig, trialPlan) {
  const next = sessionConfig;
  next.subscription_data = next.subscription_data || {};
  next.subscription_data.metadata = next.subscription_data.metadata || {};
  delete next.subscription_data.trial_period_days;
  delete next.subscription_data.trial_end;
  if (trialPlan.trial_end) next.subscription_data.trial_end = trialPlan.trial_end;
  else if (trialPlan.trial_period_days) next.subscription_data.trial_period_days = trialPlan.trial_period_days;
  next.subscription_data.metadata.bonus_days_applied = trialPlan.action === 'existing_card_bonus_offer' ? '7' : '0';
  return next;
}
/* TRIAL_POLICY_END */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { 
      companyName, 
      companyEmail, 
      companyPhone,
      twilioAccountSid, 
      twilioAuthToken,
      twilioPhoneNumber,
      skipTwilio,
      skipCalendar,
      industry
    } = body;

    console.log('🚀 Auto Setup Company - START');
    console.log('   User:', user.email);
    console.log('   Company:', companyName);

    const results = {
      company: { status: 'pending' },
      twilio: { status: skipTwilio ? 'skipped' : 'pending' },
      ai_assistants: { status: 'pending' },
      calendar: { status: skipCalendar ? 'skipped' : 'pending' }
    };

    try {
      console.log('🏢 Setting up company profile...');
      
      let existingCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
      let company = existingCompanies[0];
      
      if (!company) {
        await new Promise(resolve => setTimeout(resolve, 500));
        existingCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        company = existingCompanies[0];
      }
      
      const companyData = {
        company_name: companyName,
        email: companyEmail,
        phone: companyPhone,
        industry: industry || 'roofing',
        timezone: 'America/New_York',
        brand_primary_color: '#3b82f6',
        brand_secondary_color: '#8b5cf6',
        created_by: user.email
      };

      if (company) {
        company = await base44.asServiceRole.entities.Company.update(company.id, companyData);
        console.log('✅ Company updated (existing company found)');
      } else {
        const finalCheck = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        if (finalCheck.length > 0) {
          company = finalCheck[0];
          company = await base44.asServiceRole.entities.Company.update(company.id, companyData);
          console.log('✅ Company updated (found during final check)');
        } else {
          const trial = newCompanyTrialRecord();
          company = await base44.asServiceRole.entities.Company.create({
            ...companyData,
            subscription_status: trial.subscription_status,
            trial_ends_at: trial.trial_ends_at,
            trial_end_date: trial.trial_end_date,
          });
          console.log('✅ Company created');
        }
      }
      
      results.company = { status: 'success', company_id: company.id, company_name: company.company_name };
    } catch (error) {
      console.error('❌ Company setup failed:', error);
      if (error.message?.includes('duplicate') || error.message?.includes('unique')) {
        try {
          const existing = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
          if (existing[0]) {
            results.company = { status: 'success', company_id: existing[0].id, company_name: existing[0].company_name, note: 'Used existing company' };
            console.log('✅ Recovered existing company after duplicate error');
          } else {
            results.company = { status: 'error', message: error.message };
          }
        } catch (recoveryError) {
          results.company = { status: 'error', message: error.message };
        }
      } else {
        results.company = { status: 'error', message: error.message };
      }
    }

    // STEP 2: Auto-Configure Twilio
    if (!skipTwilio && twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
      try {
        console.log('📞 Configuring Twilio...');
        
        const formattedPhone = twilioPhoneNumber.replace(/\D/g, '');
        const twilioPhone = formattedPhone.length === 10 ? '+1' + formattedPhone : '+' + formattedPhone;
        
        // Test Twilio credentials
        const testResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}.json`, {
          headers: {
            'Authorization': 'Basic ' + btoa(twilioAccountSid + ':' + twilioAuthToken)
          }
        });

        if (!testResponse.ok) {
          throw new Error('Invalid Twilio credentials');
        }

        console.log('✅ Twilio credentials valid');

        // Auto-configure webhooks via Twilio API
        const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        const smsWebhook = `${appUrl}/api/functions/incomingSMS`;
        const voiceWebhook = `${appUrl}/api/functions/incomingCall`;
        const statusCallback = `${appUrl}/api/functions/callStatusWebhook`;

        console.log('🔧 Setting up webhooks via Twilio API...');
        
        // Find the phone number SID
        const numbersResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/IncomingPhoneNumbers.json`, {
          headers: {
            'Authorization': 'Basic ' + btoa(twilioAccountSid + ':' + twilioAuthToken)
          }
        });

        if (numbersResponse.ok) {
          const numbersData = await numbersResponse.json();
          const targetNumber = numbersData.incoming_phone_numbers?.find(n => 
            n.phone_number === twilioPhone || n.phone_number.replace(/\D/g, '') === formattedPhone
          );

          if (targetNumber) {
            console.log('📱 Found phone number:', targetNumber.phone_number);
            
            // Update webhook configuration
            const updateParams = new URLSearchParams({
              SmsUrl: smsWebhook,
              SmsMethod: 'POST',
              VoiceUrl: voiceWebhook,
              VoiceMethod: 'POST',
              StatusCallback: statusCallback,
              StatusCallbackMethod: 'POST'
            });

            const updateResponse = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/IncomingPhoneNumbers/${targetNumber.sid}.json`,
              {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + btoa(twilioAccountSid + ':' + twilioAuthToken),
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: updateParams.toString()
              }
            );

            if (updateResponse.ok) {
              console.log('✅ Webhooks configured automatically!');
              results.twilio = { 
                status: 'success', 
                message: 'Webhooks auto-configured',
                phone_number: twilioPhone,
                webhooks_configured: true
              };
            } else {
              throw new Error('Failed to configure webhooks');
            }
          } else {
            console.log('⚠️ Phone number not found, saving settings without auto-config');
            results.twilio = { 
              status: 'partial', 
              message: 'Settings saved, but webhooks need manual setup',
              phone_number: twilioPhone,
              webhooks_configured: false
            };
          }
        }

        // Save Twilio settings to database
        const existingSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ 
          company_id: results.company.company_id 
        });

        const twilioData = {
          company_id: results.company.company_id,
          account_sid: twilioAccountSid,
          auth_token: twilioAuthToken,
          main_phone_number: twilioPhone,
          enable_sms: true,
          enable_calling: true,
          enable_recording: true,
          available_numbers: []
        };

        if (existingSettings[0]) {
          await base44.asServiceRole.entities.TwilioSettings.update(existingSettings[0].id, twilioData);
        } else {
          await base44.asServiceRole.entities.TwilioSettings.create(twilioData);
        }

        console.log('✅ Twilio settings saved to database');

      } catch (error) {
        console.error('❌ Twilio setup failed:', error);
        results.twilio = { status: 'error', message: error.message };
      }
    }

    // STEP 3: Setup AI Assistants (Lexi & Sarah) with Smart Defaults
    if (results.company.status === 'success') {
      try {
        console.log('🤖 Setting up AI Assistants...');
        
        const companyId = results.company.company_id;
        const brandShortName = companyName.split(' ')[0];

        // Setup Lexi (Internal AI Assistant)
        const existingLexi = await base44.asServiceRole.entities.AssistantSettings.filter({
          company_id: companyId,
          assistant_name: 'lexi'
        });

        const lexiSettings = {
          company_id: companyId,
          assistant_name: 'lexi',
          engine: 'gpt-4o-mini',
          voice_enabled: true,
          google_voice_name: 'en-US-Neural2-F',
          voice_speaking_rate: 1.05,
          voice_pitch: 0.0,
          system_prompt: `You are Lexi, a helpful AI assistant for ${companyName}. Be warm, friendly, and efficient. Help with CRM tasks, scheduling, and customer management.`,
          brand_short_name: brandShortName
        };

        if (existingLexi[0]) {
          await base44.asServiceRole.entities.AssistantSettings.update(existingLexi[0].id, lexiSettings);
        } else {
          await base44.asServiceRole.entities.AssistantSettings.create(lexiSettings);
        }

        // Setup Sarah (Customer-Facing AI)
        const existingSarah = await base44.asServiceRole.entities.AssistantSettings.filter({
          company_id: companyId,
          assistant_name: 'sarah'
        });

        const sarahSettings = {
          company_id: companyId,
          assistant_name: 'sarah',
          engine: 'gpt-4o-mini',
          voice_enabled: true,
          google_voice_name: 'en-US-Neural2-H',
          voice_speaking_rate: 1.0,
          voice_pitch: 0.0,
          system_prompt: `You are Sarah, a friendly customer service AI for ${companyName}. Help customers with appointments, questions, and basic information. Be warm and professional.`,
          brand_short_name: brandShortName,
          short_sms_mode: true,
          max_sms_chars: 180,
          answer_then_ask_one: true,
          triage_categories: ['leak', 'missing shingles', 'hail', 'wind', 'other'],
          triage_first_question: 'What happened? (leak, missing shingles, hail, wind, other)',
          conversation_limits: {
            max_sms_turns: 10,
            max_thread_minutes: 60,
            action_at_cap: 'wrapup_notify',
            cooldown_hours: 12
          }
        };

        if (existingSarah[0]) {
          await base44.asServiceRole.entities.AssistantSettings.update(existingSarah[0].id, sarahSettings);
        } else {
          await base44.asServiceRole.entities.AssistantSettings.create(sarahSettings);
        }

        // AUTO-PROVISION THOUGHTLY AGENT
        // This ensures the subscriber gets a dedicated AI Agent and Phone Number immediately
        try {
             console.log('🤖 Auto-provisioning Thoughtly Agent...');
             // We can invoke the setup function directly since it handles the API call
             // This keeps this file cleaner and reuses the logic
             await base44.asServiceRole.functions.invoke('setupSarahThoughtly', { companyId });
             console.log('✅ Thoughtly Agent provisioned successfully');
             results.ai_assistants = { status: 'success', message: 'Lexi & Sarah configured + Thoughtly Agent created' };
        } catch (thoughtlyErr) {
             console.error('⚠️ Failed to auto-provision Thoughtly:', thoughtlyErr);
             results.ai_assistants = { status: 'partial', message: 'Assistants settings saved, but Thoughtly provisioning failed: ' + thoughtlyErr.message };
        }

      } catch (error) {
        console.error('❌ AI setup failed:', error);
        results.ai_assistants = { status: 'error', message: error.message };
      }
    }

    // STEP 4: Calendar status (user handles OAuth manually)
    if (!skipCalendar) {
      results.calendar = { 
        status: 'manual', 
        message: 'User can connect via General Settings',
        note: 'One-click OAuth connection available in settings'
      };
    }

    console.log('✅ Auto Setup Complete!');
    console.log('Results:', JSON.stringify(results, null, 2));

    return Response.json({
      success: true,
      results,
      next_steps: [
        results.calendar.status === 'manual' ? 'Connect Google Calendar (optional)' : null,
        results.twilio.status === 'partial' ? 'Complete Twilio webhook setup manually' : null,
      ].filter(Boolean)
    });

  } catch (error) {
    console.error('❌ Auto Setup Error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});