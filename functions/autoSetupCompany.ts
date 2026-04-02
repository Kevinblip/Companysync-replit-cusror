import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
          company = await base44.asServiceRole.entities.Company.create(companyData);
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