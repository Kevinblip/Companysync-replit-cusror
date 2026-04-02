import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

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

// This runs every minute via cron to process workflow steps
Deno.serve(async (req) => {
    console.log('🔄 ========== WORKFLOW QUEUE PROCESSOR ==========');
    console.log('⏰ Time:', new Date().toISOString());
    
    try {
        // 🔐 Validate CRON_SECRET_TOKEN
        const authToken = Deno.env.get('CRON_SECRET_TOKEN');
        let processedReq = req;
        
        if (authToken) {
            const requestToken = req.headers.get('Authorization')?.replace('Bearer ', '');
            if (requestToken !== authToken) {
                return Response.json({ error: 'Unauthorized - Invalid token' }, { status: 401 });
            }
            // Remove Authorization header so createClientFromRequest doesn't try to parse it as a user token
            const headers = new Headers(req.headers);
            headers.delete('Authorization');
            processedReq = new Request(req.url, { headers, body: req.body, method: req.method });
        }

        const base44 = createClientFromRequest(processedReq);

        // Get all workflow executions that need processing
        const now = new Date();
        
        // Get active executions ready to run
        const activeExecutions = await base44.asServiceRole.entities.WorkflowExecution.filter({
            status: 'active'
        });
        
        // Get trigger-waiting executions that timed out
        const waitingExecutions = await base44.asServiceRole.entities.WorkflowExecution.filter({
            status: 'waiting_for_trigger'
        });

        const executions = [...activeExecutions, ...waitingExecutions];
        console.log(`📋 Found ${executions.length} workflow executions (${activeExecutions.length} active, ${waitingExecutions.length} waiting)`);

        let processed = 0;

        for (const execution of executions) {
            try {
                // Handle trigger-based waiting
                if (execution.status === 'waiting_for_trigger') {
                    // Check if timeout reached
                    if (!execution.trigger_timeout || new Date(execution.trigger_timeout) > now) {
                        continue; // Still waiting, not timed out yet
                    }
                    
                    console.log(`⏰ Trigger timeout reached for execution ${execution.id}, proceeding...`);
                    // Will fall through to execute next step
                }
                // Handle time-based scheduling
                else if (execution.status === 'active') {
                    // Check if it's time to execute next step
                    if (!execution.next_action_time || new Date(execution.next_action_time) > now) {
                        continue; // Not time yet
                    }
                }

                console.log(`⚡ Processing execution ${execution.id} - Step ${execution.current_step}`);

                // Validate entity data exists
                if (execution.entity_type === 'Unknown' || execution.entity_id === 'unknown' || !execution.entity_id) {
                    console.error(`❌ Invalid entity data for execution ${execution.id}:`, {
                        entity_type: execution.entity_type,
                        entity_id: execution.entity_id
                    });
                    
                    await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
                        status: 'failed',
                        execution_log: [...(execution.execution_log || []), {
                            step: execution.current_step,
                            action: 'validation_failed',
                            timestamp: new Date().toISOString(),
                            success: false,
                            message: `Missing valid entity data (entity_type=${execution.entity_type}, entity_id=${execution.entity_id}). Workflow cannot execute without proper customer/lead information.`
                        }]
                    });
                    continue;
                }

                // Get the workflow
                const workflows = await base44.asServiceRole.entities.Workflow.filter({
                    id: execution.workflow_id
                });

                if (workflows.length === 0 || !workflows[0].is_active) {
                    // Workflow deleted or deactivated
                    await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
                        status: 'stopped',
                        execution_log: [...(execution.execution_log || []), {
                            step: execution.current_step,
                            action: 'Workflow stopped',
                            timestamp: new Date().toISOString(),
                            success: false,
                            message: 'Workflow no longer active'
                        }]
                    });
                    continue;
                }

                const workflow = workflows[0];
                const actions = workflow.actions || [];
                const currentStepIndex = execution.current_step;

                if (currentStepIndex >= actions.length) {
                    // Workflow complete
                    await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
                        status: 'completed',
                        execution_log: [...(execution.execution_log || []), {
                            step: currentStepIndex,
                            action: 'Workflow completed',
                            timestamp: new Date().toISOString(),
                            success: true,
                            message: 'All steps executed successfully'
                        }]
                    });
                    console.log(`✅ Workflow execution ${execution.id} completed`);
                    processed++;
                    continue;
                }

                const currentAction = actions[currentStepIndex];
                console.log(`🎬 Executing action: ${currentAction.action_type}`);

                // Get entity data for variable replacement
                let entityData = {};
                let aiData = execution.ai_data || {};
                
                if (execution.entity_type === 'Lead') {
                    const leads = await base44.asServiceRole.entities.Lead.filter({ id: execution.entity_id });
                    entityData = leads[0] || {};
                } else if (execution.entity_type === 'Customer') {
                    const customers = await base44.asServiceRole.entities.Customer.filter({ id: execution.entity_id });
                    entityData = customers[0] || {};
                } else if (execution.entity_type === 'Estimate') {
                    const estimates = await base44.asServiceRole.entities.Estimate.filter({ id: execution.entity_id });
                    entityData = estimates[0] || {};
                } else if (execution.entity_type === 'Invoice') {
                    const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: execution.entity_id });
                    entityData = invoices[0] || {};
                }

                // Helper function to replace variables in text
                const replaceVariables = (text) => {
                    if (!text) return text;
                    
                    let result = text;
                    
                    // Replace entity fields
                    result = result.replace(/\{contact_name\}/g, entityData.name || entityData.customer_name || 'Customer');
                    result = result.replace(/\{contact_email\}/g, entityData.email || entityData.customer_email || '');
                    result = result.replace(/\{contact_phone\}/g, entityData.phone || '');
                    result = result.replace(/\{entity_name\}/g, execution.entity_name || '');
                    
                    // Replace AI data fields
                    result = result.replace(/\{intent\}/g, aiData.intent || 'unknown');
                    result = result.replace(/\{sentiment\}/g, aiData.sentiment || 'neutral');
                    result = result.replace(/\{confidence\}/g, aiData.confidence || 0);
                    result = result.replace(/\{conversation_summary\}/g, aiData.summary || 'No summary available');
                    result = result.replace(/\{issue_description\}/g, aiData.issue_description || aiData.summary || '');
                    result = result.replace(/\{issue_type\}/g, aiData.issue_type || 'General inquiry');
                    result = result.replace(/\{service_type\}/g, aiData.service_type || 'service');
                    
                    // Get company data for rep info
                    result = result.replace(/\{rep_name\}/g, 'Your Sales Team');
                    result = result.replace(/\{company_name\}/g, 'Our Team');
                    
                    return result;
                };

                let actionSuccess = false;
                let actionMessage = '';

                // Execute the action based on type
                switch (currentAction.action_type) {
                    case 'send_email':
                        try {
                            const emailBody = replaceVariables(currentAction.email_body) || 'Default email content';
                            const emailSubject = replaceVariables(currentAction.email_subject) || 'Notification';

                            // Resolve recipients
                            const recipients = new Set();
                            const rawRecipient = (currentAction.recipient || '').trim();

                            if (rawRecipient.includes('@')) {
                                rawRecipient.split(',').map(r => r.trim()).filter(Boolean).forEach(r => recipients.add(r));
                            } else if (rawRecipient === 'lead' || rawRecipient === 'customer') {
                                const resolved = entityData.email || entityData.customer_email || entityData.contact_email;
                                if (resolved && resolved.includes('@')) recipients.add(resolved);
                            }

                            if (recipients.size === 0) {
                                console.error('❌ No valid email address resolved:', {
                                    recipient: currentAction.recipient,
                                    entityEmail: entityData.email || entityData.customer_email || entityData.contact_email,
                                    entityType: execution.entity_type
                                });
                                actionSuccess = false;
                                actionMessage = `No valid email address for recipient: ${currentAction.recipient}`;
                                break;
                            }

                            const resendApiKey = Deno.env.get('RESEND_API_KEY');
                            if (!resendApiKey) throw new Error('RESEND_API_KEY not configured');
                            const resend = new Resend(resendApiKey);

                            const result = await resend.emails.send({
                                from: 'AI CRM Pro <onboarding@resend.dev>',
                                to: Array.from(recipients),
                                subject: emailSubject,
                                html: emailBody
                            });

                            console.log('✅ Email sent via Resend:', result.data?.id);
                            actionSuccess = true;
                            actionMessage = `Email sent to ${Array.from(recipients).join(', ')} (Resend ID: ${result.data?.id})`;
                        } catch (error) {
                            console.error('Email error:', error);
                            actionMessage = `Email failed: ${error.message}`;
                        }
                        break;

                    case 'send_sms':
                        try {
                            const smsMessage = replaceVariables(currentAction.sms_message) || 'Notification';
                            
                            // Get phone number
                            let recipientPhone = currentAction.recipient;
                            if (recipientPhone === 'lead' || recipientPhone === 'customer') {
                                recipientPhone = entityData.phone;
                            } else if (recipientPhone === 'manager') {
                                recipientPhone = entityData.phone;
                            }

                            if (recipientPhone && execution.company_id) {
                                await base44.asServiceRole.functions.invoke('sendSMS', {
                                    to: recipientPhone,
                                    message: smsMessage,
                                    contactName: entityData.name || entityData.customer_name || 'Customer',
                                    companyId: execution.company_id
                                });
                                actionSuccess = true;
                                actionMessage = `SMS sent to ${recipientPhone}`;
                            } else {
                                actionMessage = 'No phone number or company ID found';
                            }
                        } catch (error) {
                            actionMessage = `SMS failed: ${error.message}`;
                        }
                        break;

                    case 'create_task':
                        try {
                            const taskTitle = replaceVariables(currentAction.task_title) || 'Follow up';
                            const taskDescription = replaceVariables(currentAction.task_description) || '';
                            
                            await base44.asServiceRole.entities.Task.create({
                                name: taskTitle,
                                description: taskDescription,
                                related_to: execution.entity_name,
                                assigned_to: currentAction.recipient,
                                status: 'not_started',
                                priority: currentAction.task_title?.includes('EMERGENCY') || currentAction.task_title?.includes('🚨') ? 'high' : 'medium',
                                company_id: execution.company_id
                            });
                            actionSuccess = true;
                            actionMessage = 'Task created';
                        } catch (error) {
                            actionMessage = `Task creation failed: ${error.message}`;
                        }
                        break;

                    case 'send_notification':
                        actionSuccess = true;
                        actionMessage = 'Notification sent';
                        break;

                    case 'update_record':
                        try {
                            if (execution.entity_type === 'Lead' && aiData.intent === 'get_quote') {
                                await base44.asServiceRole.entities.Lead.update(execution.entity_id, {
                                    status: 'qualified',
                                    notes: (entityData.notes || '') + `\n\n[${new Date().toLocaleString()}] AI detected high intent - marked as HOT lead`
                                });
                                actionSuccess = true;
                                actionMessage = 'Lead marked as qualified/hot';
                            } else {
                                actionSuccess = true;
                                actionMessage = 'Record update skipped (no changes needed)';
                            }
                        } catch (error) {
                            actionMessage = `Update failed: ${error.message}`;
                        }
                        break;

                    case 'wait':
                        actionSuccess = true;
                        actionMessage = `Waiting ${currentAction.delay_minutes || 0} minutes`;
                        break;

                    default:
                        actionMessage = `Unknown action type: ${currentAction.action_type}`;
                }

                console.log(`${actionSuccess ? '✅' : '❌'} Action result: ${actionMessage}`);

                // Calculate next action time based on schedule type
                const nextStep = currentStepIndex + 1;
                let nextActionTime = null;
                let nextStatus = 'active';
                let waitingForEvent = null;
                let triggerTimeout = null;
                let recurringSchedule = execution.recurring_schedule;
                
                // Workflow completed - log only
                if (nextStep >= actions.length) {
                    console.log(`✅ Workflow "${workflow.workflow_name}" completed for ${execution.entity_name}`);
                }

                if (nextStep < actions.length) {
                    const nextAction = actions[nextStep];
                    
                    switch (nextAction.schedule_type) {
                        case 'specific_time': {
                            if (nextAction.specific_datetime) {
                                nextActionTime = new Date(nextAction.specific_datetime);
                            }
                            break;
                        }

                        case 'recurring': {
                            if (nextAction.recurring_pattern) {
                                const pattern = nextAction.recurring_pattern;
                                
                                // Check if we've reached max occurrences
                                if (pattern.max_occurrences && recurringSchedule?.occurrences_count >= pattern.max_occurrences) {
                                    console.log(`Max occurrences (${pattern.max_occurrences}) reached for recurring action`);
                                    break;
                                }
                                
                                // Check if past end date
                                if (pattern.end_date && new Date(pattern.end_date) < new Date()) {
                                    console.log(`End date reached for recurring action`);
                                    break;
                                }
                                
                                // Calculate next occurrence
                                const fromDate = recurringSchedule?.next_occurrence ? new Date(recurringSchedule.next_occurrence) : new Date();
                                nextActionTime = calculateNextRecurrence(fromDate, pattern);
                                
                                // Update recurring schedule
                                recurringSchedule = {
                                    next_occurrence: nextActionTime.toISOString(),
                                    occurrences_count: (recurringSchedule?.occurrences_count || 0) + 1,
                                    last_occurrence: new Date().toISOString()
                                };
                            }
                            break;
                        }

                        case 'trigger_based': {
                            if (nextAction.trigger_condition) {
                                nextStatus = 'waiting_for_trigger';
                                waitingForEvent = nextAction.trigger_condition.wait_for_event;
                                
                                if (nextAction.trigger_condition.timeout_minutes) {
                                    triggerTimeout = new Date(Date.now() + nextAction.trigger_condition.timeout_minutes * 60 * 1000);
                                }
                            }
                            break;
                        }

                        case 'delay':
                        default: {
                            const delayMinutes = nextAction.delay_minutes || 0;
                            nextActionTime = new Date(Date.now() + delayMinutes * 60 * 1000);
                            break;
                        }
                    }
                }

                // Update execution
                const updateData = {
                    current_step: nextStep,
                    completed_steps: [...(execution.completed_steps || []), currentStepIndex],
                    next_action_time: nextActionTime ? nextActionTime.toISOString() : null,
                    status: nextStatus,
                    execution_log: [...(execution.execution_log || []), {
                        step: currentStepIndex,
                        action: currentAction.action_type,
                        timestamp: new Date().toISOString(),
                        success: actionSuccess,
                        message: actionMessage
                    }]
                };
                
                if (waitingForEvent) {
                    updateData.waiting_for_event = waitingForEvent;
                }
                if (triggerTimeout) {
                    updateData.trigger_timeout = triggerTimeout.toISOString();
                }
                if (recurringSchedule) {
                    updateData.recurring_schedule = recurringSchedule;
                }

                await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, updateData);

                processed++;

            } catch (error) {
                console.error(`❌ Error processing execution ${execution.id}:`, error);
                
                // Log error but don't stop workflow
                try {
                    await base44.asServiceRole.entities.WorkflowExecution.update(execution.id, {
                        execution_log: [...(execution.execution_log || []), {
                            step: execution.current_step,
                            action: 'Error',
                            timestamp: new Date().toISOString(),
                            success: false,
                            message: error.message
                        }]
                    });
                } catch (logError) {
                    console.error('Failed to log error:', logError);
                }
            }
        }

        console.log(`✅ Workflow processor complete: ${processed}/${executions.length} processed`);

        return Response.json({
            success: true,
            message: `Processed ${processed} workflow steps`,
            totalActive: executions.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Process Workflow Queue Error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
});