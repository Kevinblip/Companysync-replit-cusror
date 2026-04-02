import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { companyId, dryRun = false } = await req.json();

    if (!companyId) {
      return Response.json({ error: 'companyId required' }, { status: 400 });
    }

    console.log('🕐 Scanning for timezone issues...');

    const issues = [];
    let fixedCount = 0;

    // 1. Check calendar events for 12-hour offset issues
    const events = await base44.asServiceRole.entities.CalendarEvent.filter({ company_id: companyId });
    console.log(`📅 Checking ${events.length} calendar events...`);

    for (const event of events) {
      if (!event.start_time) continue;

      const startTime = new Date(event.start_time);
      const currentHour = startTime.getHours();

      // Detect if event is using 24-hour format incorrectly (PM times showing as AM)
      // Example: 2:00 PM stored as 2:00 AM (off by 12 hours)
      const description = event.description || '';
      const title = event.title || '';
      
      // Check if time looks suspiciously wrong (e.g., business events at 2 AM)
      if (currentHour >= 0 && currentHour < 6) {
        // Events between midnight and 6 AM are suspicious for business context
        const fixedTime = new Date(startTime);
        fixedTime.setHours(startTime.getHours() + 12);

        issues.push({
          entity: 'CalendarEvent',
          id: event.id,
          title: event.title,
          issue: `Event scheduled for ${currentHour}:${String(startTime.getMinutes()).padStart(2, '0')} (suspicious early morning time)`,
          original_time: event.start_time,
          suggested_fix: fixedTime.toISOString(),
          confidence: 'medium'
        });

        if (!dryRun) {
          const fixedEnd = event.end_time ? new Date(new Date(event.end_time).getTime() + 12 * 60 * 60 * 1000) : null;
          await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
            start_time: fixedTime.toISOString(),
            ...(fixedEnd && { end_time: fixedEnd.toISOString() })
          });
          fixedCount++;
        }
      }
    }

    // 2. Check task due dates
    const tasks = await base44.asServiceRole.entities.Task.filter({ company_id: companyId });
    console.log(`📋 Checking ${tasks.length} tasks...`);

    for (const task of tasks) {
      if (!task.due_date) continue;

      const dueDate = new Date(task.due_date);
      const hour = dueDate.getHours();

      // Tasks with due dates at midnight are normal, but 12:00 PM might be wrong
      if (hour === 12) {
        issues.push({
          entity: 'Task',
          id: task.id,
          name: task.name,
          issue: `Due date at noon (12:00 PM) - might need to be midnight (12:00 AM)`,
          original_time: task.due_date,
          confidence: 'low'
        });
      }
    }

    // 3. Check workflow executions for scheduled action times
    const executions = await base44.asServiceRole.entities.WorkflowExecution.filter({ company_id: companyId });
    console.log(`⚡ Checking ${executions.length} workflow executions...`);

    for (const execution of executions) {
      if (!execution.next_action_time) continue;

      const actionTime = new Date(execution.next_action_time);
      const now = new Date();
      
      // If action time is more than 30 days in the past, it's likely wrong
      const daysPast = Math.floor((now - actionTime) / (1000 * 60 * 60 * 24));
      if (daysPast > 30) {
        issues.push({
          entity: 'WorkflowExecution',
          id: execution.id,
          workflow: execution.workflow_name,
          issue: `Next action time is ${daysPast} days in the past`,
          original_time: execution.next_action_time,
          confidence: 'high'
        });
      }
    }

    // 4. Check reminders
    const allReminders = await base44.asServiceRole.entities.Task.filter({ company_id: companyId });
    const tasksWithReminders = allReminders.filter(t => t.reminders && t.reminders.length > 0);
    
    console.log(`🔔 Checking ${tasksWithReminders.length} tasks with reminders...`);

    for (const task of tasksWithReminders) {
      for (const reminder of task.reminders || []) {
        if (!reminder.reminder_date) continue;

        const reminderDate = new Date(reminder.reminder_date);
        const hour = reminderDate.getHours();

        // Reminders at 2 AM - 6 AM are suspicious
        if (hour >= 2 && hour < 6) {
          issues.push({
            entity: 'TaskReminder',
            id: task.id,
            name: task.name,
            reminder_id: reminder.id,
            issue: `Reminder scheduled for ${hour}:${String(reminderDate.getMinutes()).padStart(2, '0')} (early morning)`,
            original_time: reminder.reminder_date,
            confidence: 'medium'
          });

          if (!dryRun) {
            // Fix by adding 12 hours
            const fixedDate = new Date(reminderDate);
            fixedDate.setHours(reminderDate.getHours() + 12);

            const updatedReminders = task.reminders.map(r => 
              r.id === reminder.id 
                ? { ...r, reminder_date: fixedDate.toISOString() }
                : r
            );

            await base44.asServiceRole.entities.Task.update(task.id, {
              reminders: updatedReminders
            });
            fixedCount++;
          }
        }
      }
    }

    const summary = {
      total_issues_found: issues.length,
      calendar_events: issues.filter(i => i.entity === 'CalendarEvent').length,
      tasks: issues.filter(i => i.entity === 'Task').length,
      workflow_executions: issues.filter(i => i.entity === 'WorkflowExecution').length,
      task_reminders: issues.filter(i => i.entity === 'TaskReminder').length,
      fixed_count: fixedCount,
      issues: issues
    };

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        message: `Found ${issues.length} potential timezone issues. Run with dryRun=false to fix.`,
        summary
      });
    }

    return Response.json({
      success: true,
      message: `Fixed ${fixedCount} timezone issues out of ${issues.length} found.`,
      summary
    });

  } catch (error) {
    console.error('❌ Timezone fix error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});