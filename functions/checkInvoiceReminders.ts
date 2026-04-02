import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify cron secret token for security
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const expectedToken = Deno.env.get('CRON_SECRET_TOKEN');
    
    if (!expectedToken || token !== expectedToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all companies
    const companies = await base44.asServiceRole.entities.Company.list();
    
    let totalReminders = 0;
    
    for (const company of companies) {
      // Get all unpaid invoices for this company
      const allInvoices = await base44.asServiceRole.entities.Invoice.filter({
        company_id: company.id
      });
      
      const unpaidInvoices = allInvoices.filter(inv => 
        inv.status !== 'paid' && 
        inv.status !== 'cancelled' &&
        inv.due_date // Must have a due date
      );
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (const invoice of unpaidInvoices) {
        const dueDate = new Date(invoice.due_date);
        dueDate.setHours(0, 0, 0, 0);
        
        const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        
        // Check if reminder should be sent (every 3 days after due date)
        const shouldSendReminder = daysPastDue > 0 && daysPastDue % 3 === 0;
        
        if (shouldSendReminder) {
          // Get staff profile for assigned sales agent
          let assignedStaff = null;
          if (invoice.sale_agent) {
            const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
              user_email: invoice.sale_agent,
              company_id: company.id
            });
            assignedStaff = staffProfiles[0];
          }
          
          // Create in-app notification
          await base44.asServiceRole.entities.Notification.create({
            company_id: company.id,
            user_email: invoice.sale_agent || company.created_by,
            title: `💰 Payment Reminder: Invoice ${invoice.invoice_number}`,
            message: `Invoice ${invoice.invoice_number} for ${invoice.customer_name} is ${daysPastDue} days overdue ($${invoice.amount?.toFixed(2)}). Please follow up!`,
            type: 'invoice_reminder',
            related_entity_type: 'Invoice',
            related_entity_id: invoice.id,
            link_url: `/invoice-details?id=${invoice.id}`,
            is_read: false
          });
          
          // Send email reminder
          try {
            await base44.asServiceRole.functions.invoke('sendEmailWithResend', {
              to: invoice.sale_agent || company.created_by,
              subject: `Payment Reminder: Invoice ${invoice.invoice_number} - ${daysPastDue} Days Overdue`,
              body: `
                <h2>Payment Follow-Up Required</h2>
                <p><strong>Invoice:</strong> ${invoice.invoice_number}</p>
                <p><strong>Customer:</strong> ${invoice.customer_name}</p>
                <p><strong>Amount:</strong> $${invoice.amount?.toFixed(2)}</p>
                <p><strong>Days Overdue:</strong> ${daysPastDue} days</p>
                <p><strong>Amount Paid:</strong> $${(invoice.amount_paid || 0).toFixed(2)}</p>
                <p><strong>Remaining:</strong> $${((invoice.amount || 0) - (invoice.amount_paid || 0)).toFixed(2)}</p>
                <br>
                <p>Please follow up with the customer to collect payment.</p>
              `
            });
          } catch (emailError) {
            console.error('Email send failed:', emailError);
          }
          
          // Send SMS reminder if staff has phone configured
          if (assignedStaff?.phone_number) {
            try {
              await base44.asServiceRole.functions.invoke('sendSMS', {
                to: assignedStaff.phone_number,
                message: `Payment Reminder: Invoice ${invoice.invoice_number} for ${invoice.customer_name} is ${daysPastDue} days overdue ($${invoice.amount?.toFixed(2)}). Please follow up!`
              });
            } catch (smsError) {
              console.error('SMS send failed:', smsError);
            }
          }
          
          totalReminders++;
        }
      }
    }
    
    return Response.json({ 
      success: true, 
      reminders_sent: totalReminders,
      message: `Processed invoice reminders for ${companies.length} companies`
    });
    
  } catch (error) {
    console.error('Invoice reminder check error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});