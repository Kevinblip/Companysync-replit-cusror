import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    // This should be called by a cron job (e.g., daily at 8am)
    // For now, it's a manual trigger
    
    const base44 = createClientFromRequest(req);
    
    // Use service role to access all reports
    const reports = await base44.asServiceRole.entities.SavedReport.list();
    
    const now = new Date();
    const sentReports = [];

    for (const report of reports) {
      if (!report.schedule?.enabled) continue;
      
      const nextSend = report.schedule.next_send ? new Date(report.schedule.next_send) : null;
      
      // Check if it's time to send
      if (!nextSend || nextSend > now) continue;

      try {
        // Generate report data
        let data = [];
        switch(report.report_type) {
          case 'invoices':
            data = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
            break;
          case 'estimates':
            data = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
            break;
          case 'payments':
            data = await base44.asServiceRole.entities.Payment.list('-payment_date', 10000);
            break;
          case 'customers':
            data = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
            break;
          case 'leads':
            data = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
            break;
        }

        // Apply filters
        // ... (filtering logic based on report.filters)

        // Generate CSV
        const columns = report.columns || [];
        let csv = columns.join(',') + '\n';
        
        data.forEach(row => {
          csv += columns.map(col => `"${row[col] || ''}"`).join(',') + '\n';
        });

        // Send email to each recipient
        for (const recipient of report.schedule.recipients || []) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: recipient,
            subject: `Scheduled Report: ${report.report_name}`,
            body: `
              <h2>Your scheduled report is ready</h2>
              <p>Report: ${report.report_name}</p>
              <p>Generated: ${now.toLocaleString()}</p>
              <p>Total Records: ${data.length}</p>
              <p>See attached CSV file.</p>
            `
            // TODO: Attach CSV file
          });
        }

        // Update next send time
        let nextSendDate = new Date(now);
        switch(report.schedule.frequency) {
          case 'daily':
            nextSendDate.setDate(nextSendDate.getDate() + 1);
            break;
          case 'weekly':
            nextSendDate.setDate(nextSendDate.getDate() + 7);
            break;
          case 'monthly':
            nextSendDate.setMonth(nextSendDate.getMonth() + 1);
            break;
        }

        await base44.asServiceRole.entities.SavedReport.update(report.id, {
          schedule: {
            ...report.schedule,
            next_send: nextSendDate.toISOString()
          }
        });

        sentReports.push(report.report_name);
      } catch (error) {
        console.error(`Error sending report ${report.report_name}:`, error);
      }
    }

    return Response.json({
      success: true,
      message: `Sent ${sentReports.length} scheduled reports`,
      reports: sentReports
    });
  } catch (error) {
    console.error('Scheduled reports error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});