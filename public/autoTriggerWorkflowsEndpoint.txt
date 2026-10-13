import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';
import twilio from 'npm:twilio@5.0.0';

// Inline SMS sender (Base44 functions are standalone, no relative imports)
async function sendSMSInternal(base44, { to, body, companyId, contactName, userEmail }) {
    if (!to || !body) throw new Error('Missing to/body');
    console.log(`[SMS] Starting send to ${to} for company ${companyId || 'unknown'}`);
    const envSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const envToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const envPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
    let dbSettings = null;
    let targetCompanyId = companyId;
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
    if (!finalSid.startsWith('AC')) throw new Error('Twilio is not configured.');
    if (!finalToken) throw new Error('Missing Twilio Auth Token.');
    if (!finalPhone) throw new Error('Missing Twilio Phone Number.');
    const client = twilio(finalSid, finalToken);
    const message = await client.messages.create({ body, from: finalPhone, to });
    console.log('[SMS] Sent, SID:', message.sid);
    if (targetCompanyId) {
        try {
            await base44.asServiceRole.entities.Communication.create({
                company_id: targetCompanyId, contact_phone: to, contact_name: contactName || 'Unknown',
                communication_type: 'sms', direction: 'outbound', message: body,
                twilio_sid: message.sid, status: 'sent', created_by: userEmail || 'system'
            });
        } catch (e) { console.error('[SMS] Log failed:', e); }
    }
    return { success: true, sid: message.sid };
}

// 🔄 WORKFLOW AUTOMATION CRON ENDPOINT
// Called every 1-5 minutes to process scheduled/delayed workflow steps
// Handles: send_email, send_sms, create_task, send_notification, wait

function replaceVariables(text, data, companyInfo = null) {
  if (!text) return text;
  let result = text;

  const normalizedEmail = data?.customer_email || data?.contact_email || data?.email || data?.lead_email || '';
  const normalizedPhone = data?.customer_phone || data?.contact_phone || data?.phone || data?.lead_phone || '';
  const normalizedName = data?.customer_name || data?.contact_name || data?.lead_name || data?.name || 'Customer';
  const normalizedAddress = data?.address || data?.property_address || data?.street || '';

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
    '{app_url}': data?.app_url || 'https://getcompanysync.com',
  };

  for (const [placeholder, value] of Object.entries(varMap)) {
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  return result;
}

function resolveRecipientEmail(recipientField, entityData) {
  if (!recipientField) return null;
  if (recipientField === 'lead' || recipientField === 'customer') {
    return entityData?.email || entityData?.customer_email || entityData?.contact_email || entityData?.lead_email || null;
  }
  if (recipientField.includes('@')) return recipientField;
  return null;
}

function resolveRecipientPhone(recipientField, entityData) {
  if (!recipientField) return null;
  if (recipientField === 'lead' || recipientField === 'customer') {
    return entityData?.phone || entityData?.customer_phone || entityData?.contact_phone || entityData?.lead_phone || null;
  }
  return recipientField;
}

async function executeStepAction(base44, action, entityData, companyId, companyInfo) {
  const actionType = action.action_type || action.type;
  console.log(`  📌 Executing: ${actionType} (Step ${action.step})`);

  switch (actionType) {
    case 'send_email': {
      const recipientEmail = resolveRecipientEmail(action.recipient, entityData);
      if (!recipientEmail) {
        console.warn(`  ⚠️ No email recipient found for: ${action.recipient}`);
        return { success: false, error: 'No recipient email' };
      }

      const subject = replaceVariables(action.email_subject || 'Notification', entityData, companyInfo);
      const body = replaceVariables(action.email_body || '', entityData, companyInfo);

      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      if (!RESEND_API_KEY) {
        console.error('  ❌ RESEND_API_KEY not configured');
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: recipientEmail,
            subject: subject,
            body: body
          });
          console.log(`  ✅ Email sent via Core to ${recipientEmail}`);
          return { success: true };
        } catch (coreError) {
          console.error('  ❌ Core.SendEmail also failed:', coreError);
          return { success: false, error: coreError.message };
        }
      }

      const resend = new Resend(RESEND_API_KEY);
      const fromName = companyInfo?.company_name || 'AI CRM Pro';
      const fromEmail = `noreply@mycrewcam.com`;

      const result = await resend.emails.send({
        from: fromEmail,
        to: [recipientEmail],
        subject: subject,
        html: body
      });

      if (result.error) {
        console.error(`  ❌ Resend error:`, result.error);
        return { success: false, error: JSON.stringify(result.error) };
      }

      console.log(`  ✅ Email sent to ${recipientEmail} (Resend ID: ${result.data?.id})`);
      return { success: true, resendId: result.data?.id };
    }

    case 'send_sms': {
      const phone = resolveRecipientPhone(action.recipient, entityData);
      if (!phone) {
        console.warn(`  ⚠️ No phone number found for SMS: ${action.recipient}`);
        return { success: false, error: 'No phone number' };
      }

      const message = replaceVariables(action.sms_message || '', entityData, companyInfo);

      try {
        const smsResult = await sendSMSInternal(base44, {
          to: phone,
          body: message,
          contactName: entityData?.contact_name || entityData?.customer_name || entityData?.name || 'Customer',
          companyId: companyId,
          userEmail: 'workflow-cron'
        });
        console.log(`  ✅ SMS sent to ${phone} (SID: ${smsResult.sid})`);
        return { success: true, sid: smsResult.sid };
      } catch (smsError) {
        console.error(`  ❌ SMS failed:`, smsError.message);
        return { success: false, error: smsError.message };
      }
    }

    case 'create_task': {
      const title = replaceVariables(action.task_title || 'Follow-up Task', entityData, companyInfo);
      const description = replaceVariables(action.task_description || '', entityData, companyInfo);

      await base44.asServiceRole.entities.Task.create({
        company_id: companyId,
        name: title,
        description: description,
        status: 'not_started',
        source: 'workflow',
        related_to: entityData?.customer_name || entityData?.contact_name || entityData?.name
      });
      console.log(`  ✅ Task created: ${title}`);
      return { success: true };
    }

    case 'send_notification': {
      const title = replaceVariables(action.notification_title || 'Notification', entityData, companyInfo);
      const message = replaceVariables(action.notification_message || '', entityData, companyInfo);
      const recipientEmail = resolveRecipientEmail(action.recipient, entityData);

      if (recipientEmail) {
        await base44.asServiceRole.entities.Notification.create({
          company_id: companyId,
          user_email: recipientEmail,
          title: title,
          message: message,
          type: 'general',
          is_read: false
        });
        console.log(`  ✅ Notification created for ${recipientEmail}`);
      }
      return { success: true };
    }

    case 'wait': {
      console.log('  ⏳ Wait action (handled by scheduling)');
      return { success: true };
    }

    default: {
      console.warn(`  ⚠️ Unknown action type: ${actionType}`);
      return { success: false, error: `Unknown action: ${actionType}` };
    }
  }
}

Deno.serve(async (req) => {
  try {
    const authToken = Deno.env.get('CRON_SECRET_TOKEN');
    let processedReq = req;

    if (authToken) {
      const requestToken = req.headers.get('Authorization')?.replace('Bearer ', '');
      if (requestToken !== authToken) {
        return Response.json({ error: 'Unauthorized - Invalid token' }, { status: 401 });
      }
      const headers = new Headers(req.headers);
      headers.delete('Authorization');
      processedReq = new Request(req.url, { headers, body: req.body, method: req.method });
    }

    console.log('🔄 [CRON] Starting workflow automation check...');
    const base44 = createClientFromRequest(processedReq);

    const now = new Date();
    const allExecutions = await base44.asServiceRole.entities.WorkflowExecution.list('-created_date', 1000);

    const pendingExecutions = allExecutions.filter(exec =>
      exec.status === 'pending' || exec.status === 'active'
    );

    console.log(`📊 Found ${pendingExecutions.length} pending/active workflow executions`);

    const readyToExecute = pendingExecutions.filter(exec => {
      if (!exec.next_action_time) return true;
      return new Date(exec.next_action_time) <= now;
    });

    console.log(`⚡ ${readyToExecute.length} executions ready to run now`);

    const results = [];

    for (const execution of readyToExecute) {
      try {
        console.log(`\n🔄 Processing execution ${execution.id} (workflow: ${execution.workflow_name || execution.workflow_id})`);

        const workflows = await base44.asServiceRole.entities.Workflow.filter({
          id: execution.workflow_id
        });

        if (workflows.length === 0) {
          console.error(`  ❌ Workflow not found: ${execution.workflow_id}`);
          await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
            status: 'failed',
            error_message: 'Workflow not found'
          });
          results.push({ execution_id: execution.id, success: false, error: 'Workflow not found' });
          continue;
        }

        const workflow = workflows[0];

        if (!workflow.is_active) {
          await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
            status: 'cancelled',
            error_message: 'Workflow deactivated'
          });
          results.push({ execution_id: execution.id, success: false, error: 'Workflow not active' });
          continue;
        }

        let companyInfo = null;
        if (execution.company_id) {
          try {
            const companies = await base44.asServiceRole.entities.Company.filter({ id: execution.company_id });
            companyInfo = companies[0];
          } catch (e) {
            console.log('  ⚠️ Could not fetch company info');
          }
        }

        const actions = workflow.actions || workflow.steps || [];
        // Sort actions by step number to ensure correct ordering
        const sortedActions = [...actions].sort((a, b) => (a.step || 0) - (b.step || 0));

        // current_step stores the count of completed steps (0-based count)
        // Next step to execute has step number = current_step + 1 (steps are 1-based)
        let stepNumber = (execution.current_step || 0) + 1;
        let stepsExecutedThisRun = 0;
        let keepGoing = true;

        console.log(`  📋 ${sortedActions.length} total actions, starting from step ${stepNumber}`);

        while (keepGoing) {
          const currentAction = sortedActions.find(a => a.step === stepNumber);

          if (!currentAction) {
            console.log(`  ✅ No action found for step ${stepNumber} — workflow complete!`);
            await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              current_step: stepNumber - 1
            });
            results.push({ execution_id: execution.id, success: true, message: 'Workflow completed' });
            keepGoing = false;
            break;
          }

          // If this is a "wait" action, schedule the NEXT step after the wait
          if (currentAction.action_type === 'wait') {
            const delayMinutes = currentAction.delay_minutes || 0;
            const nextTime = new Date(Date.now() + delayMinutes * 60000);

            // Mark this wait step as completed, schedule next step
            await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
              current_step: stepNumber,  // wait step is "completed"
              next_action_time: nextTime.toISOString(),
              status: 'active'
            });

            console.log(`  ⏰ Wait step ${stepNumber}: ${delayMinutes} min delay. Next action at ${nextTime.toISOString()}`);
            results.push({ execution_id: execution.id, success: true, step_executed: stepNumber, type: 'wait', waiting_until: nextTime.toISOString() });
            keepGoing = false;
            break;
          }

          // If this action has a delay AND it's NOT the first thing we're executing this run
          // (first action's delay was already waited for via next_action_time scheduling)
          if (stepsExecutedThisRun > 0 && (currentAction.delay_minutes || 0) > 0) {
            const delayMinutes = currentAction.delay_minutes;
            const nextTime = new Date(Date.now() + delayMinutes * 60000);

            // Don't execute yet — schedule it for later
            await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
              current_step: stepNumber - 1,  // previous step completed
              next_action_time: nextTime.toISOString(),
              status: 'active'
            });

            console.log(`  ⏰ Step ${stepNumber} has ${delayMinutes} min delay. Scheduled for ${nextTime.toISOString()}`);
            results.push({ execution_id: execution.id, success: true, waiting_for_step: stepNumber, waiting_until: nextTime.toISOString() });
            keepGoing = false;
            break;
          }

          // Execute the action
          const actionResult = await executeStepAction(base44, currentAction, execution.entity_data || {}, execution.company_id, companyInfo);
          stepsExecutedThisRun++;

          // Check if there's a next action
          const nextStepNumber = stepNumber + 1;
          const nextAction = sortedActions.find(a => a.step === nextStepNumber);

          if (!nextAction) {
            // No more steps — workflow done
            await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              current_step: stepNumber
            });
            console.log(`  ✅ Step ${stepNumber} done — workflow complete!`);
            results.push({ execution_id: execution.id, success: true, message: 'Workflow completed', last_step: stepNumber });
            keepGoing = false;
          } else {
            // There's a next step — continue the loop to check if it's immediate or delayed
            stepNumber = nextStepNumber;
          }
        }

      } catch (execError) {
        console.error(`  ❌ Error processing execution ${execution.id}:`, execError.message);
        await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
          status: 'failed',
          error_message: execError.message
        });
        results.push({ execution_id: execution.id, success: false, error: execError.message });
      }
    }

    console.log('\n✅ Workflow cron check completed');

    return Response.json({
      success: true,
      message: 'Workflow automation check completed',
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total_pending: pendingExecutions.length,
        executed: readyToExecute.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('❌ Workflow automation error:', error);
    return Response.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
