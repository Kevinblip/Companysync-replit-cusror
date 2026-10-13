import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    console.log('🎤 Voice Lexi webhook received');
    
    const webhookData = await req.json();
    console.log('Webhook data:', JSON.stringify(webhookData, null, 2));

    const base44 = createClientFromRequest(req);

    // Extract call information from Thoughtly webhook
    const {
      call_id,
      agent_id,
      from_number, // Staff member's phone
      to_number,   // Lexi's number
      status,
      duration_seconds,
      transcript,
      recording_url,
      started_at,
      ended_at,
      summary,
      // Voice command extraction
      user_intent,
      extracted_data
    } = webhookData;

    // Find which company this Voice Lexi agent belongs to
    const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ 
      voice_lexi_agent_id: agent_id 
    });

    if (!twilioSettings || twilioSettings.length === 0) {
      console.log('⚠️ No company found for Voice Lexi agent:', agent_id);
      return Response.json({ success: false, error: 'Agent not linked to any company' });
    }

    const setting = twilioSettings[0];
    const companyId = setting.company_id;

    console.log('✅ Found company:', companyId);

    // Identify staff member by phone number
    const staffMembers = await base44.asServiceRole.entities.User.filter({
      company_id: companyId
    });

    const staffMember = staffMembers.find(s => 
      s.phone === from_number || s.twilio_number === from_number
    );

    const staffName = staffMember ? staffMember.full_name : 'Unknown Staff';
    const staffEmail = staffMember ? staffMember.email : null;

    console.log('👤 Staff member:', staffName);

    // Log the voice interaction
    const communication = await base44.asServiceRole.entities.Communication.create({
      company_id: companyId,
      contact_name: staffName,
      contact_phone: from_number,
      communication_type: 'call',
      direction: 'inbound',
      subject: `Voice Lexi - ${user_intent || 'Staff Request'}`,
      message: summary || transcript || 'Voice command to Lexi',
      transcription: transcript || null,
      recording_url: recording_url || null,
      twilio_sid: call_id,
      status: status === 'completed' ? 'completed' : 'failed',
      duration_minutes: duration_seconds ? Math.ceil(duration_seconds / 60) : null,
      intent: user_intent || null,
      ai_analyzed: true,
      ai_data: {
        intent: user_intent || null,
        summary: summary || null,
        extracted_data: extracted_data || null,
        is_internal: true,
        staff_member: staffName
      }
    });

    console.log('✅ Voice interaction logged:', communication.id);

    // 🎯 EXECUTE VOICE COMMANDS
    let actionResults = [];

    // Parse user intent and execute CRM actions
    if (user_intent) {
      const intent = user_intent.toLowerCase();

      // CREATE LEAD
      if (intent.includes('create lead') || intent.includes('new lead') || intent.includes('add lead')) {
        try {
          const leadData = extracted_data || {};
          
          const newLead = await base44.asServiceRole.entities.Lead.create({
            company_id: companyId,
            name: leadData.name || leadData.customer_name || 'New Lead',
            phone: leadData.phone || leadData.phone_number || '',
            email: leadData.email || '',
            company: leadData.company || '',
            address: leadData.address || '',
            source: 'voice_lexi',
            lead_source: `Voice command by ${staffName}`,
            status: 'new',
            assigned_to: staffEmail || null,
            notes: summary || `Created via Voice Lexi: ${transcript || ''}`
          });

          actionResults.push(`✅ Lead created: ${newLead.name}`);
          console.log('✅ Lead created:', newLead.id);
        } catch (error) {
          console.error('❌ Failed to create lead:', error);
          actionResults.push(`❌ Failed to create lead: ${error.message}`);
        }
      }

      // SCHEDULE APPOINTMENT
      if (intent.includes('schedule') || intent.includes('appointment') || intent.includes('meeting') || intent.includes('calendar')) {
        try {
          const eventData = extracted_data || {};
          
          let startTime = eventData.date_time || eventData.start_time;
          if (startTime && !startTime.includes('T')) {
            // If just a date, set to 9am
            startTime = `${startTime}T09:00:00`;
          }
          if (!startTime) {
            // Default to tomorrow at 9am
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            startTime = tomorrow.toISOString();
          }

          const newEvent = await base44.asServiceRole.entities.CalendarEvent.create({
            title: eventData.title || eventData.event_title || `Appointment with ${eventData.customer_name || 'Customer'}`,
            description: summary || transcript || '',
            start_time: startTime,
            event_type: eventData.event_type || 'appointment',
            location: eventData.location || eventData.address || '',
            related_customer: eventData.customer_name || '',
            assigned_to: staffEmail || null,
            status: 'scheduled'
          });

          actionResults.push(`✅ Appointment scheduled: ${newEvent.title}`);
          console.log('✅ Event created:', newEvent.id);
        } catch (error) {
          console.error('❌ Failed to create event:', error);
          actionResults.push(`❌ Failed to schedule: ${error.message}`);
        }
      }

      // CREATE TASK
      if (intent.includes('create task') || intent.includes('remind me') || intent.includes('follow up')) {
        try {
          const taskData = extracted_data || {};
          
          const newTask = await base44.asServiceRole.entities.Task.create({
            name: taskData.task_name || taskData.title || 'Follow up',
            description: summary || transcript || '',
            priority: taskData.priority || 'medium',
            due_date: taskData.due_date || null,
            assigned_to: staffEmail || null,
            status: 'not_started',
            related_to: taskData.customer_name || ''
          });

          actionResults.push(`✅ Task created: ${newTask.name}`);
          console.log('✅ Task created:', newTask.id);
        } catch (error) {
          console.error('❌ Failed to create task:', error);
          actionResults.push(`❌ Failed to create task: ${error.message}`);
        }
      }

      // LOOKUP CUSTOMER/LEAD
      if (intent.includes('find') || intent.includes('lookup') || intent.includes('search') || intent.includes('who is')) {
        try {
          const searchName = extracted_data?.name || extracted_data?.customer_name || '';
          
          if (searchName) {
            const customers = await base44.asServiceRole.entities.Customer.filter({
              company_id: companyId
            });
            
            const leads = await base44.asServiceRole.entities.Lead.filter({
              company_id: companyId
            });

            const foundCustomer = customers.find(c => 
              c.name.toLowerCase().includes(searchName.toLowerCase())
            );

            const foundLead = leads.find(l => 
              l.name.toLowerCase().includes(searchName.toLowerCase())
            );

            if (foundCustomer) {
              actionResults.push(`📋 Found customer: ${foundCustomer.name}, Phone: ${foundCustomer.phone || 'N/A'}, Email: ${foundCustomer.email || 'N/A'}`);
            } else if (foundLead) {
              actionResults.push(`📋 Found lead: ${foundLead.name}, Status: ${foundLead.status}, Phone: ${foundLead.phone || 'N/A'}`);
            } else {
              actionResults.push(`❌ No customer or lead found named "${searchName}"`);
            }
          }
        } catch (error) {
          console.error('❌ Failed to lookup:', error);
        }
      }
    }

    // Update communication with action results
    if (actionResults.length > 0) {
      await base44.asServiceRole.entities.Communication.update(communication.id, {
        notes: `Actions performed:\n${actionResults.join('\n')}`
      });
    }

    return Response.json({
      success: true,
      message: 'Voice command processed',
      staff_member: staffName,
      actions_performed: actionResults.length,
      actions: actionResults,
      communication_id: communication.id
    });

  } catch (error) {
    console.error('❌ Voice Lexi webhook error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});