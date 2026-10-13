import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { format } from 'npm:date-fns@3.0.0';

// Comprehensive timezone validation across the entire system
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('🔍 Running comprehensive timezone validation...');

    const report = {
      scan_time: new Date().toISOString(),
      issues: [],
      warnings: [],
      summary: {}
    };

    // Get all entities that use timestamps
    const companies = await base44.asServiceRole.entities.Company.list();
    
    for (const company of companies) {
      console.log(`\n🏢 Scanning company: ${company.company_name}`);

      // 1. Calendar Events
      const events = await base44.asServiceRole.entities.CalendarEvent.filter({ company_id: company.id });
      let eventIssues = 0;
      
      for (const event of events) {
        if (!event.start_time) continue;

        const startTime = new Date(event.start_time);
        const hour = startTime.getHours();
        const dayOfWeek = startTime.getDay();

        // Red flags for business events:
        // - Between midnight and 5 AM (unless it's a reminder/personal event)
        // - On weekends at odd hours for inspection/meeting types
        const isSuspiciousHour = (hour >= 0 && hour < 5);
        const isSuspiciousType = ['inspection', 'meeting', 'estimate', 'appointment'].includes(event.event_type);

        if (isSuspiciousHour && isSuspiciousType) {
          report.issues.push({
            type: 'calendar_event',
            entity: 'CalendarEvent',
            id: event.id,
            company: company.company_name,
            title: event.title,
            event_type: event.event_type,
            current_time: format(startTime, 'MMM d, yyyy h:mm a'),
            hour_24: startTime.getHours(),
            issue: `Business event scheduled between midnight-5am`,
            severity: 'high',
            suggested_fix: `Add 12 hours (move to ${format(new Date(startTime.getTime() + 12 * 60 * 60 * 1000), 'h:mm a')})`
          });
          eventIssues++;
        }
      }

      // 2. Task Reminders
      const tasks = await base44.asServiceRole.entities.Task.filter({ company_id: company.id });
      let reminderIssues = 0;

      for (const task of tasks) {
        if (!task.reminders || task.reminders.length === 0) continue;

        for (const reminder of task.reminders) {
          if (!reminder.reminder_date) continue;

          const reminderDate = new Date(reminder.reminder_date);
          const hour = reminderDate.getHours();

          if (hour >= 0 && hour < 6) {
            report.issues.push({
              type: 'task_reminder',
              entity: 'Task',
              id: task.id,
              company: company.company_name,
              task_name: task.name,
              current_time: format(reminderDate, 'MMM d, yyyy h:mm a'),
              hour_24: hour,
              issue: `Reminder scheduled between midnight-6am`,
              severity: 'medium',
              suggested_fix: `Add 12 hours (move to ${format(new Date(reminderDate.getTime() + 12 * 60 * 60 * 1000), 'h:mm a')})`
            });
            reminderIssues++;
          }
        }
      }

      // 3. Workflow Scheduled Actions
      const workflows = await base44.asServiceRole.entities.WorkflowExecution.filter({ 
        company_id: company.id,
        status: 'active'
      });
      let workflowIssues = 0;

      for (const execution of workflows) {
        if (!execution.next_action_time) continue;

        const actionTime = new Date(execution.next_action_time);
        const now = new Date();

        // If scheduled action is way in the past, it's stuck
        const hoursPast = Math.floor((now - actionTime) / (1000 * 60 * 60));
        if (hoursPast > 24) {
          report.warnings.push({
            type: 'workflow_stuck',
            entity: 'WorkflowExecution',
            id: execution.id,
            company: company.company_name,
            workflow: execution.workflow_name,
            current_time: format(actionTime, 'MMM d, yyyy h:mm a'),
            issue: `Next action scheduled ${hoursPast} hours ago (workflow may be stuck)`,
            severity: 'high'
          });
          workflowIssues++;
        }
      }

      // 4. Invoices - check due dates
      const invoices = await base44.asServiceRole.entities.Invoice.filter({ company_id: company.id });
      let invoiceIssues = 0;

      for (const invoice of invoices) {
        if (!invoice.due_date) continue;

        const dueDate = new Date(invoice.due_date);
        const hour = dueDate.getHours();

        // Due dates should typically be at midnight or end of day, not noon
        if (hour === 12) {
          report.warnings.push({
            type: 'invoice_due_date',
            entity: 'Invoice',
            id: invoice.id,
            company: company.company_name,
            invoice_number: invoice.invoice_number,
            current_time: format(dueDate, 'MMM d, yyyy h:mm a'),
            issue: `Due date at noon (should be midnight or end of day)`,
            severity: 'low'
          });
          invoiceIssues++;
        }
      }

      console.log(`  → Events: ${eventIssues} issues, Reminders: ${reminderIssues} issues, Workflows: ${workflowIssues} warnings, Invoices: ${invoiceIssues} warnings`);
    }

    report.summary = {
      total_issues: report.issues.length,
      total_warnings: report.warnings.length,
      high_severity: report.issues.filter(i => i.severity === 'high').length,
      medium_severity: report.issues.filter(i => i.severity === 'medium').length,
      low_severity: [...report.issues, ...report.warnings].filter(i => i.severity === 'low').length,
      by_type: {
        calendar_events: report.issues.filter(i => i.type === 'calendar_event').length,
        task_reminders: report.issues.filter(i => i.type === 'task_reminder').length,
        workflow_stuck: report.warnings.filter(i => i.type === 'workflow_stuck').length,
        invoice_due_dates: report.warnings.filter(i => i.type === 'invoice_due_date').length,
      }
    };

    return Response.json({
      success: true,
      message: `Scan complete. Found ${report.summary.total_issues} issues and ${report.summary.total_warnings} warnings.`,
      report
    });

  } catch (error) {
    console.error('❌ Timezone validation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});