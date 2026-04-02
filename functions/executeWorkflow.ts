import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';
import twilio from 'npm:twilio@5.0.0';

async function sendSMSInternal(base44, { to, body, companyId, contactName, userEmail }) {
    if (!to || !body) throw new Error('Missing to/body');
    console.log(`[SMS] Starting send to ${to} for company ${companyId || 'unknown'}`);
    const envSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const envToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const envPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
    let dbSettings = null;
    let targetCompanyId = companyId;
    if (!targetCompanyId && userEmail && userEmail !== 'workflow') {
        const staff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: userEmail });
        if (staff?.length > 0 && staff[0].company_id) {
            targetCompanyId = staff[0].company_id;
        } else {
            const companies = await base44.asServiceRole.entities.Company.filter({ created_by: userEmail });
            if (companies?.length > 0) targetCompanyId = companies[0].id;
        }
    }
    if (targetCompanyId) {
        const settings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: targetCompanyId });
        if (settings?.length > 0) dbSettings = settings[0];
    }
    const clean = (val) => val ? String(val).trim().replace(/[\s\u200B-\u200D\uFEFF"']/g, '') : '';
    const isValidSid = (sid) => clean(sid).startsWith('AC');
    let finalSid = '';
    let finalToken = '';
    let finalPhone = '';
    let source = '';
    if (dbSettings && isValidSid(dbSettings.account_sid) && dbSettings.auth_token && dbSettings.main_phone_number) {
        finalSid = clean(dbSettings.account_sid);
        finalToken = clean(dbSettings.auth_token);
        finalPhone = clean(dbSettings.main_phone_number);
        source = 'DB';
    }
    if (!finalSid && isValidSid(envSid) && envToken && envPhone) {
        finalSid = clean(envSid);
        finalToken = clean(envToken);
        finalPhone = clean(envPhone);
        source = 'ENV';
    }
    console.log(`[SMS] Credential Source: ${source || 'NONE'}`);
    if (!finalSid.startsWith('AC')) throw new Error('Twilio is not configured for this company.');
    if (!finalToken) throw new Error('Missing Twilio Auth Token.');
    if (!finalPhone) throw new Error('Missing Twilio Phone Number.');
    try {
        const client = twilio(finalSid, finalToken);
        const message = await client.messages.create({ body, from: finalPhone, to });
        console.log('[SMS] Sent successfully, SID:', message.sid);
        if (targetCompanyId) {
            try {
                await base44.asServiceRole.entities.Communication.create({
                    company_id: targetCompanyId,
                    contact_phone: to,
                    contact_name: contactName || 'Unknown',
                    communication_type: 'sms',
                    direction: 'outbound',
                    message: body,
                    twilio_sid: message.sid,
                    status: 'sent',
                    created_by: userEmail || 'system'
                });
            } catch (logError) {
                console.error('[SMS] Failed to log to DB:', logError);
            }
        }
        return { success: true, sid: message.sid };
    } catch (error) {
        console.error('[SMS] Twilio API Error:', error);
        let errorMsg = error.message;
        if (error.code === 21211) errorMsg = "Invalid 'To' Phone Number.";
        if (error.code === 21606) errorMsg = "The 'From' phone number is not valid for this account.";
        if (error.code === 20003) errorMsg = "Authentication Error - Check Account SID and Auth Token.";
        if (error.code === 21608) errorMsg = "This number is unverified (Trial Account).";
        throw new Error(`Twilio Error (${source}): ${errorMsg} (Code: ${error.code})`);
    }
}

// Helper function to calculate next recurrence
function calculateNextRecurrence(fromDate, pattern) {
  const next = new Date(fromDate);
  const timeOfDay = pattern.time_of_day || '09:00';
  const [hours, minutes] = timeOfDay.split(':').map(Number);

  switch (pattern.frequency) {
    case 'daily': {
      next.setDate(next.getDate() + (pattern.interval || 1));
      break;
    }

    case 'weekly': {
      const targetDays = pattern.days_of_week || [1];
      const currentDay = next.getDay();
      let daysToAdd = targetDays.find(d => d > currentDay) - currentDay;
      
      if (daysToAdd <= 0) {
        daysToAdd = (7 - currentDay) + targetDays[0];
      }
      
      next.setDate(next.getDate() + daysToAdd);
      break;
    }

    case 'monthly': {
      const targetDay = pattern.day_of_month || 1;
      next.setMonth(next.getMonth() + (pattern.interval || 1));
      next.setDate(Math.min(targetDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
    }

    case 'yearly': {
      next.setFullYear(next.getFullYear() + (pattern.interval || 1));
      break;
    }
  }

  next.setHours(hours, minutes, 0, 0);
  return next;
}

function replaceVariables(text, data, companyInfo = null) {
  if (!text) return text;
  
  let result = text;
  
  // Normalize all field names from different entities
  const normalizedEmail = data?.customer_email || data?.contact_email || data?.email || data?.lead_email || '';
  const normalizedPhone = data?.customer_phone || data?.contact_phone || data?.phone || data?.lead_phone || '';
  const normalizedName = data?.customer_name || data?.contact_name || data?.lead_name || data?.name || 'Customer';
  const normalizedAddress = data?.address || data?.property_address || data?.street || '';
  
  // Company info from fetched company data
  const companyName = companyInfo?.company_name || data?.company_name || 'Our Company';
  const companyPhone = companyInfo?.phone_number || data?.company_phone || '';
  const companyEmail = companyInfo?.email_address || data?.company_email || '';
  const companyAddress = companyInfo?.company_address || data?.company_address || '';
  const companyWebsite = companyInfo?.company_website || data?.company_website || '';
  const companyLogo = companyInfo?.logo_url || data?.company_logo || '';
  
  const varMap = {
    '{contact_name}': normalizedName,
    '{customer_name}': normalizedName,
    '{lead_name}': normalizedName,
    '{name}': normalizedName,
    '{contact_email}': normalizedEmail,
    '{customer_email}': normalizedEmail,
    '{lead_email}': normalizedEmail,
    '{email}': normalizedEmail,
    '{contact_phone}': normalizedPhone,
    '{customer_phone}': normalizedPhone,
    '{lead_phone}': normalizedPhone,
    '{phone}': normalizedPhone,
    '{address}': normalizedAddress,
    '{property_address}': normalizedAddress,
    '{company_name}': companyName,
    '{company_phone}': companyPhone,
    '{company_email}': companyEmail,
    '{company_address}': companyAddress,
    '{company_website}': companyWebsite,
    '{company_logo}': companyLogo,
    '{estimate_number}': data?.estimate_number || '',
    '{invoice_number}': data?.invoice_number || '',
    '{project_name}': data?.project_name || '',
    '{proposal_number}': data?.proposal_number || '',
    '{task_name}': data?.task_name || data?.name || '',
    '{payment_amount}': data?.payment_amount || data?.amount || '',
    '{amount}': data?.amount || data?.payment_amount || '',
    '{status}': data?.status || '',
    '{source}': data?.source || data?.lead_source || '',
    '{assigned_to}': data?.assigned_to || '',
    '{assigned_to_name}': data?.assigned_to_name || '',
    '{created_by}': data?.created_by || '',
    '{app_url}': data?.app_url || 'https://getcompanysync.com',
  };

  for (const [placeholder, value] of Object.entries(varMap)) {
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  return result;
}

async function sendNotification(base44, action, entityData, workflowCompanyId) {
  try {
    const title = replaceVariables(action.notification_title || 'Notification', entityData);
    const message = replaceVariables(action.notification_message || '', entityData);
    
    let recipientEmail = action.recipient;
    
    if (recipientEmail === 'lead' || recipientEmail === 'customer') {
      recipientEmail = entityData.contact_email || entityData.customer_email || entityData.email;
    }
    
    if (!recipientEmail) {
      console.warn('⚠️ No recipient email for notification');
      return;
    }

    await base44.asServiceRole.entities.Notification.create({
      company_id: workflowCompanyId,
      user_email: recipientEmail,
      title: title,
      message: message,
      type: 'general',
      is_read: false
    });

    console.log('✅ Notification created for:', recipientEmail);
  } catch (error) {
    console.error('❌ Failed to create notification:', error);
    throw error;
  }
}

async function createTask(base44, action, entityData, workflowCompanyId) {
  try {
    const title = replaceVariables(action.task_title || 'Task', entityData);
    const description = replaceVariables(action.task_description || '', entityData);

    await base44.asServiceRole.entities.Task.create({
      company_id: workflowCompanyId,
      name: title,
      description: description,
      status: 'not_started',
      related_to: entityData.contact_name || entityData.customer_name || entityData.name
    });

    console.log('✅ Task created:', title);
  } catch (error) {
    console.error('❌ Failed to create task:', error);
    throw error;
  }
}

async function sendSMS(base44, action, entityData, workflowCompanyId) {
  try {
    let recipient = action.recipient;
    
    if (recipient === 'lead' || recipient === 'customer') {
      recipient = entityData.contact_phone || entityData.customer_phone || entityData.phone;
    }
    
    if (!recipient) {
      console.warn('⚠️ No phone number for SMS');
      return;
    }

    const message = replaceVariables(action.sms_message || '', entityData);

    const smsResult = await sendSMSInternal(base44, {
      to: recipient,
      body: message,
      contactName: entityData.contact_name || entityData.customer_name || entityData.name,
      companyId: workflowCompanyId,
      userEmail: 'workflow'
    });

    if (smsResult.success) {
      console.log('✅ SMS sent to:', recipient);
    }
  } catch (error) {
    console.error('❌ Failed to send SMS:', error);
    throw error;
  }
}

async function sendEmail(base44, action, entityData, workflowCompanyId, companyInfo = null) {
  try {
    console.log('📧 sendEmail started');
    console.log('   → Action recipient field:', action.recipient);
    console.log('   → Entity data keys:', Object.keys(entityData));
    console.log('   → customer_email:', entityData.customer_email);
    console.log('   → contact_email:', entityData.contact_email);
    console.log('   → email:', entityData.email);
    
    let recipients = [];
    
    // Support comma-separated recipients
    const recipientField = action.recipient || '';
    const recipientList = recipientField.split(',').map(r => r.trim()).filter(r => r);
    
    for (const recipient of recipientList) {
      // If recipient is 'customer' or 'lead', resolve the email from entity data
      if (recipient === 'lead' || recipient === 'customer') {
        const resolvedEmail = entityData.email || entityData.customer_email || entityData.contact_email || entityData.lead_email;
        console.log('   → Resolving customer/lead email:', resolvedEmail);
        if (resolvedEmail && resolvedEmail.includes('@')) {
          recipients.push(resolvedEmail);
        } else {
          console.warn(`   ⚠️ No email found for ${recipient} in entity data`);
        }
      } else if (recipient.includes('@')) {
        // Check notification preferences before adding staff/admin
        try {
          const prefs = await base44.asServiceRole.entities.NotificationPreference.filter({ 
            user_email: recipient,
            company_id: workflowCompanyId 
          });
          const userPref = prefs[0];
          
          if (userPref?.mute_all_notifications) {
            console.log(`⏭️ Skipping ${recipient} - notifications muted`);
            continue;
          }
          
          // Check if this is their own action
          const createdBy = entityData.created_by || entityData.assigned_to;
          const isOwnAction = createdBy === recipient;
          
          // Check specific preferences
          const triggerType = entityData.trigger_type || '';
          if (triggerType.includes('lead_created') && userPref?.notify_on_lead_created === false) {
            console.log(`⏭️ Skipping ${recipient} - lead notifications disabled`);
            continue;
          }
          if (triggerType.includes('lead_created') && isOwnAction && userPref?.notify_on_lead_created_by_others_only) {
            console.log(`⏭️ Skipping ${recipient} - own lead creation`);
            continue;
          }
          if (triggerType.includes('customer_created') && userPref?.notify_on_customer_created === false) {
            console.log(`⏭️ Skipping ${recipient} - customer notifications disabled`);
            continue;
          }
          if (triggerType.includes('customer_created') && isOwnAction && userPref?.notify_on_customer_created_by_others_only) {
            console.log(`⏭️ Skipping ${recipient} - own customer creation`);
            continue;
          }
        } catch (e) {
          console.log('⚠️ Could not check notification preferences:', e.message);
        }
        
        recipients.push(recipient);
      }
    }
    
    console.log('   → Resolved recipients after filtering:', recipients);
    
    // CRITICAL: If no valid recipients found, throw detailed error
    if (recipients.length === 0) {
      const errorMsg = `❌ NO EMAIL ADDRESSES FOUND!\n` +
        `   Recipient field: "${action.recipient}"\n` +
        `   Checked: customer_email, contact_email, email, lead_email\n` +
        `   Entity data: ${JSON.stringify(entityData, null, 2)}\n` +
        `   💡 TIP: Use actual emails (e.g., yicnteam@gmail.com, sis@example.com) or comma-separated list`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    const subject = replaceVariables(action.email_subject || 'Notification', entityData, companyInfo);
    const body = replaceVariables(action.email_body || '', entityData, companyInfo);
    
    console.log('✅ Email details ready');
    console.log('   → To:', recipients);
    console.log('   → Subject:', subject);

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY not configured in environment variables');
      throw new Error('RESEND_API_KEY not configured');
    }

    console.log('✅ RESEND_API_KEY found');
    const resend = new Resend(RESEND_API_KEY);

    const fromName = companyInfo?.company_name || 'AI CRM Pro';
    const fromEmail = `noreply@mycrewcam.com`;

    console.log('📤 Attempting to send email via Resend...');
    console.log('   → From:', fromEmail);
    console.log('   → To:', recipients);
    console.log('   → Subject:', subject);

    const result = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject: subject,
      html: body
    });

    if (result.error) {
      console.error('❌ Resend API returned error:', result.error);
      throw new Error(`Resend error: ${JSON.stringify(result.error)}`);
    }

    console.log('✅ Email sent successfully via Resend!');
    console.log('   → Resend ID:', result.data?.id);
    console.log('   → Recipients:', recipients);
    
    return {
      success: true,
      recipients: recipients,
      subject: subject,
      resendId: result.data?.id
    };

  } catch (error) {
    console.error('❌ Failed to send email:', error);
    console.error('   → Error details:', error.message);
    console.error('   → Stack:', error.stack);
    throw error;
  }
}

async function executeAction(base44, action, entityData, workflowCompanyId, companyInfo = null) {
  console.log(`📌 Executing action: ${action.action_type} (Step ${action.step})`);

  const actionType = action.action_type || action.type;
  switch (actionType) {
    case 'send_email': {
      const emailResult = await sendEmail(base44, action, entityData, workflowCompanyId, companyInfo);
      console.log('📧 Email result:', emailResult);
      return emailResult;
    }
    case 'send_sms':
      await sendSMS(base44, action, entityData, workflowCompanyId);
      break;
    case 'create_task':
      await createTask(base44, action, entityData, workflowCompanyId);
      break;
    case 'send_notification':
      await sendNotification(base44, action, entityData, workflowCompanyId);
      break;
    case 'wait':
      console.log('⏳ Wait action (handled by scheduling)');
      break;
    default:
      console.warn(`⚠️ Unknown action type: ${action.action_type}`);
  }
}

async function executeWorkflowInstance(base44, workflow, entityData) {
  console.log(`🚀 Starting workflow: ${workflow.workflow_name}`);
  console.log('📦 Entity data received:', JSON.stringify(entityData, null, 2));
  console.log('📋 Workflow actions:', JSON.stringify(workflow.actions, null, 2));

  const workflowCompanyId = workflow.company_id;

  // Fetch company info for variable replacement
  let companyInfo = null;
  if (workflowCompanyId) {
    try {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: workflowCompanyId });
      companyInfo = companies[0];
      console.log('   → Company info loaded:', companyInfo?.company_name);
    } catch (e) {
      console.log('⚠️ Could not fetch company info:', e.message);
    }
  }

  // Use "actions" field (new format) OR "steps" field (legacy format)
  const allActions = workflow.actions || workflow.steps || [];
  // Sort by step number to process in correct order
  const sortedActions = [...allActions].sort((a, b) => (a.step || 0) - (b.step || 0));
  console.log(`📋 Total actions in workflow: ${sortedActions.length}`);

  // Execute actions IN ORDER, stopping at first delay/wait
  const results = [];
  let lastExecutedStep = 0;
  let stoppedAtAction = null;

  for (const action of sortedActions) {
    const delayMinutes = action.delay_minutes || action.config?.delay_minutes || 0;
    const isWait = action.action_type === 'wait';
    const isScheduled = ['trigger_based', 'specific_time', 'recurring'].includes(action.schedule_type);

    // Stop at first delayed, wait, or scheduled action
    if (isWait || delayMinutes > 0 || isScheduled) {
      stoppedAtAction = action;
      console.log(`⏰ Stopping at step ${action.step} (${isWait ? 'wait' : isScheduled ? action.schedule_type : 'delay'}: ${delayMinutes} min)`);
      break;
    }

    // Execute immediate action
    try {
      const result = await executeAction(base44, action, entityData, workflowCompanyId, companyInfo);
      results.push({ step: action.step, success: true, result });
      lastExecutedStep = action.step;
      console.log(`✅ Step ${action.step} completed:`, result);
    } catch (error) {
      results.push({ step: action.step, success: false, error: error.message });
      lastExecutedStep = action.step;
      console.error(`❌ Step ${action.step} FAILED:`, error.message);
    }
  }

  console.log('📊 Workflow execution summary:', results);

  // Schedule remaining actions if we stopped at a delay/wait
  if (stoppedAtAction) {
    let nextActionTime = null;
    let status = 'active';
    let waitingForEvent = null;
    let triggerTimeout = null;
    let recurringSchedule = null;

    // Calculate next action time based on schedule type
    switch (stoppedAtAction.schedule_type) {
      case 'specific_time': {
        if (stoppedAtAction.specific_datetime) {
          nextActionTime = new Date(stoppedAtAction.specific_datetime);
        }
        break;
      }

      case 'recurring': {
        if (stoppedAtAction.recurring_pattern) {
          const pattern = stoppedAtAction.recurring_pattern;
          const now = new Date();
          const nextOccurrence = calculateNextRecurrence(now, pattern);
          nextActionTime = nextOccurrence;
          recurringSchedule = {
            next_occurrence: nextOccurrence.toISOString(),
            occurrences_count: 0,
            last_occurrence: null
          };
        }
        break;
      }

      case 'trigger_based': {
        if (stoppedAtAction.trigger_condition) {
          status = 'waiting_for_trigger';
          waitingForEvent = stoppedAtAction.trigger_condition.wait_for_event;
          if (stoppedAtAction.trigger_condition.timeout_minutes) {
            triggerTimeout = new Date(Date.now() + stoppedAtAction.trigger_condition.timeout_minutes * 60 * 1000);
          }
        }
        break;
      }

      case 'delay':
      default: {
        const delayMinutes = stoppedAtAction.delay_minutes || 0;
        nextActionTime = new Date(Date.now() + delayMinutes * 60 * 1000);
        break;
      }
    }

    // For "wait" actions: current_step = the wait step itself (it's "completed"/consumed)
    // For actions with delays/schedules: current_step = last executed step (the action hasn't run yet)
    const currentStepToStore = stoppedAtAction.action_type === 'wait'
      ? stoppedAtAction.step  // wait is consumed
      : lastExecutedStep;     // delayed/scheduled action hasn't run

    await base44.asServiceRole.entities.WorkflowExecution.create({
      company_id: workflowCompanyId,
      workflow_id: workflow.id,
      workflow_name: workflow.workflow_name,
      entity_type: entityData.entity_type || 'Unknown',
      entity_id: entityData.entity_id || 'unknown',
      entity_name: entityData.contact_name || entityData.customer_name || entityData.name || 'Unknown',
      entity_data: entityData,
      current_step: currentStepToStore,
      status: status,
      next_action_time: nextActionTime ? nextActionTime.toISOString() : null,
      waiting_for_event: waitingForEvent,
      trigger_timeout: triggerTimeout ? triggerTimeout.toISOString() : null,
      recurring_schedule: recurringSchedule,
      completed_steps: results.map(r => r.step),
      execution_log: [
        {
          step: 0,
          action: 'workflow_started',
          timestamp: new Date().toISOString(),
          success: true,
          message: `Workflow execution started. Completed ${results.length} immediate steps. Next: step ${stoppedAtAction.step} (${stoppedAtAction.schedule_type || 'delay'})`
        }
      ]
    });

    console.log(`⏰ Scheduled next action (${stoppedAtAction.schedule_type || 'delay'}) at ${nextActionTime ? nextActionTime.toISOString() : 'awaiting trigger'}`);
  }

  // Update workflow execution count
  await base44.asServiceRole.entities.Workflow.update(workflow.id, {
    execution_count: (workflow.execution_count || 0) + 1,
    last_executed: new Date().toISOString()
  });

  // 📱 Send SMS notification to admins when workflow starts
  try {
    const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: workflowCompanyId });
    const admins = allStaff.filter(s => s.is_administrator && s.phone_number);

    for (const admin of admins) {
      try {
        await base44.asServiceRole.functions.invoke('sendSMS', {
          to: admin.phone_number,
          message: `🔄 Workflow Started: "${workflow.workflow_name}" for ${entityData.contact_name || entityData.customer_name || entityData.name || 'entity'}`,
          contactName: admin.full_name,
          companyId: workflowCompanyId,
          calledFromService: true
        });
        console.log(`📱 Workflow start SMS sent to admin: ${admin.user_email}`);
      } catch (smsError) {
        console.error(`Failed to send SMS to ${admin.user_email}:`, smsError);
      }
    }
  } catch (error) {
    console.error('Failed to send workflow start SMS:', error);
  }

  console.log('✅ Workflow execution completed');
}

Deno.serve(async (req) => {
  try {
    console.log('🔄 executeWorkflow function started');

    const base44 = createClientFromRequest(req);
    
    // Service role for workflow execution
    const body = await req.json();
    console.log('📦 Received body:', JSON.stringify(body, null, 2));
    
    const { workflow_id, workflowId, entity_data, entityData, entity_type, entity_id } = body;
    const finalWorkflowId = workflow_id || workflowId;
    
    // Merge top-level entity info if present
    const finalEntityData = {
      ...(entity_data || entityData || {}),
      entity_type: (entity_data?.entity_type || entityData?.entity_type || entity_type),
      entity_id: (entity_data?.entity_id || entityData?.entity_id || entity_id)
    };

    if (!finalWorkflowId) {
      console.error('❌ No workflow_id provided');
      return Response.json({ error: 'Workflow ID required' }, { status: 400 });
    }

    console.log('🔍 Looking up workflow:', finalWorkflowId);
    const workflows = await base44.asServiceRole.entities.Workflow.filter({ id: finalWorkflowId });
    
    if (!workflows || workflows.length === 0) {
      return Response.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const workflow = workflows[0];

    if (!workflow.is_active) {
      return Response.json({ error: 'Workflow is not active' }, { status: 400 });
    }

    await executeWorkflowInstance(base44, workflow, finalEntityData);

    return Response.json({ 
      success: true, 
      message: 'Workflow executed successfully',
      workflowName: workflow.workflow_name,
      actionsExecuted: (workflow.actions || workflow.steps || []).length
    });

  } catch (error) {
    console.error('💥 ERROR in executeWorkflow:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});