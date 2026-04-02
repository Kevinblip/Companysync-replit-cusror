import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';
import { sendSMSInternal } from './utils/smsSender.js';

/**
 * 🔔 UNIVERSAL NOTIFICATION DISPATCHER
 * 
 * Centralizes ALL notification logic for the entire app.
 * Automatically sends bell notifications + Resend emails for any entity change.
 * 
 * Usage:
 *   await base44.functions.invoke('universalNotificationDispatcher', {
 *     action: 'create' | 'update' | 'delete',
 *     entityType: 'Customer' | 'Invoice' | 'Payment' | etc.,
 *     entityId: string,
 *     entityData: object,
 *     companyId: string
 *   });
 */

Deno.serve(async (req) => {
  console.log('🔔 ========== UNIVERSAL NOTIFICATION DISPATCHER ==========');
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, entityType, entityId, entityData, companyId } = body;

    if (!action || !entityType || !entityId || !companyId) {
      return Response.json({ 
        error: 'Missing required fields: action, entityType, entityId, companyId' 
      }, { status: 400 });
    }

    console.log(`📋 Processing: ${action} ${entityType} (ID: ${entityId})`);

    // Get company and staff
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId });
    const adminEmails = allStaff.filter(s => s.is_administrator).map(s => s.user_email);

    // Fetch Notification Preferences
    const allPreferences = await base44.asServiceRole.entities.NotificationPreference.filter({ company_id: companyId });

    // Initialize Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY not configured');
      return Response.json({ error: 'Email service not configured' }, { status: 500 });
    }

    const resend = new Resend(resendApiKey);
    const fromEmail = `${company?.company_name || 'CRM'} <noreply@mycrewcam.com>`;

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Determine notification recipients and content based on entity type
    const notificationConfig = await getNotificationConfig(entityType, action, entityData, allStaff, adminEmails, user, base44);

    if (!notificationConfig) {
      console.log(`ℹ️ No notification config for ${entityType} ${action}`);
      return Response.json({ success: true, message: 'No notifications to send' });
    }

    // Send notifications to all recipients
    for (const recipient of notificationConfig.recipients) {
      try {
        // Check preferences
        const prefs = allPreferences.find(p => p.user_email === recipient.email);
        
        // Default to TRUE if no prefs found (respecting schema defaults behavior conceptually)
        // But we implement specific logic:
        if (prefs) {
           if (prefs.mute_all_notifications) {
             console.log(`🔕 Skipping ${recipient.email} (Mute All)`);
             continue;
           }

           // Check specific notification types
           let shouldNotify = true;

           // Helper to check specific flag
           const checkFlag = (flagName) => {
             // If property exists in prefs, use it. Otherwise default to true (or whatever schema says)
             // In JS, if key is missing in object, it's undefined.
             // We'll treat undefined as TRUE for existing keys to maintain backward compatibility,
             // unless we want to change default behavior.
             return prefs[flagName] !== false; 
           };

           switch (notificationConfig.type) {
             case 'lead_created':
               shouldNotify = checkFlag('notify_on_lead_created');
               if (shouldNotify && prefs.notify_on_lead_created_by_others_only && user.email === recipient.email) {
                 shouldNotify = false;
               }
               break;
             case 'customer_created':
               shouldNotify = checkFlag('notify_on_customer_created');
               if (shouldNotify && prefs.notify_on_customer_created_by_others_only && user.email === recipient.email) {
                 shouldNotify = false;
               }
               break;
             case 'estimate_created':
               shouldNotify = checkFlag('notify_on_estimate_created');
               break;
             case 'estimate_accepted':
               shouldNotify = checkFlag('notify_on_estimate_accepted');
               break;
             case 'invoice_created':
               shouldNotify = checkFlag('notify_on_invoice_created');
               break;
             case 'invoice_paid':
               shouldNotify = checkFlag('notify_on_invoice_paid');
               break;
             case 'payment_received':
               shouldNotify = checkFlag('notify_on_payment_received');
               break;
             case 'task_assigned':
               shouldNotify = checkFlag('notify_on_task_assigned');
               break;
             case 'task_completed':
               shouldNotify = checkFlag('notify_on_task_completed');
               break;
           }

           if (!shouldNotify) {
             console.log(`🔕 Skipping ${recipient.email} (Preference: ${notificationConfig.type} = off)`);
             continue;
           }
        }

        console.log(`📧 Notifying ${recipient.email}: ${notificationConfig.title}`);

        // Bell notification
        await base44.asServiceRole.entities.Notification.create({
          company_id: companyId,
          user_email: recipient.email,
          title: notificationConfig.title,
          message: notificationConfig.message,
          type: notificationConfig.type,
          related_entity_type: entityType,
          related_entity_id: entityId,
          link_url: notificationConfig.linkUrl,
          is_read: false
        });

        // Email notification
        const htmlBody = generateEmailHTML(
          notificationConfig.title,
          notificationConfig.message,
          entityType,
          entityData,
          company,
          user,
          notificationConfig.linkUrl,
          recipient.isAssignee
        );

        await resend.emails.send({
          from: fromEmail,
          to: recipient.email,
          subject: notificationConfig.emailSubject || notificationConfig.title,
          html: htmlBody
        });

        // 📱 SMS notification to ALL recipients (assignees + admins)
        try {
          const recipientStaff = allStaff.find(s => s.user_email === recipient.email);
          if (recipientStaff?.phone) {
            // Add 2 second delay to avoid Twilio rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));

            const smsMessage = recipient.isAssignee 
              ? `${notificationConfig.title} (ASSIGNED TO YOU): ${notificationConfig.message}`
              : `${notificationConfig.title}: ${notificationConfig.message}`;

            // Format phone number with + if not present
            let phoneNumber = recipientStaff.phone;
            if (!phoneNumber.startsWith('+')) {
              phoneNumber = '+1' + phoneNumber.replace(/\D/g, '');
            }

            await sendSMSInternal(base44, {
              to: phoneNumber,
              body: smsMessage,
              contactName: recipientStaff.full_name,
              companyId: companyId,
              userEmail: 'system'
            });
            console.log(`📱 SMS sent to ${recipient.isAssignee ? 'assignee' : 'admin'}: ${recipient.email}`);
          }
        } catch (smsError) {
          console.error(`⚠️ SMS failed for ${recipient.email}:`, smsError.message);
          errors.push(`SMS failed for ${recipient.email}: ${smsError.message}`);
        }

        successCount++;
      } catch (error) {
        console.error(`❌ Failed to notify ${recipient.email}:`, error.message);
        errorCount++;
        errors.push({ email: recipient.email, error: error.message });
      }
    }

    console.log(`✅ COMPLETED: ${successCount} sent, ${errorCount} failed`);

    return Response.json({
      success: true,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ CRITICAL ERROR:', error.message);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});

/**
 * Determine who gets notified and what the notification says
 */
async function getNotificationConfig(entityType, action, entityData, allStaff, adminEmails, creator, base44) {
  switch (entityType) {
    case 'Customer':
      return getCustomerNotificationConfig(action, entityData, allStaff, adminEmails, creator);
    
    case 'Invoice':
      return getInvoiceNotificationConfig(action, entityData, allStaff, adminEmails, creator);
    
    case 'Payment':
      return await getPaymentNotificationConfig(action, entityData, allStaff, adminEmails, creator, base44);
    
    case 'Estimate':
      return getEstimateNotificationConfig(action, entityData, allStaff, adminEmails, creator);
    
    case 'Lead':
      return getLeadNotificationConfig(action, entityData, allStaff, adminEmails, creator);
    
    case 'Task':
      return getTaskNotificationConfig(action, entityData, allStaff, adminEmails, creator);
    
    default:
      return null;
  }
}

function getCustomerNotificationConfig(action, customer, allStaff, adminEmails, creator) {
  if (action !== 'create') return null;

  const assigneeEmails = customer.assigned_to_users || [];
  const assigneeNames = assigneeEmails.map(email => {
    const staff = allStaff.find(s => s.user_email === email);
    return staff?.full_name || email;
  }).join(', ');

  const recipients = [];

  // Notify assignees
  assigneeEmails.forEach(email => {
    recipients.push({ email, isAssignee: true });
  });

  // Notify all admins
  adminEmails.forEach(email => {
    if (!recipients.find(r => r.email === email)) {
      recipients.push({ email, isAssignee: false });
    }
  });

  return {
    recipients,
    title: '👤 New Customer Created',
    message: `New customer: ${customer.name}${assigneeNames ? ` (assigned to ${assigneeNames})` : ''}`,
    emailSubject: `👤 New Customer: ${customer.name}`,
    type: 'customer_created',
    linkUrl: `/CustomerProfile?id=${customer.id}`
  };
}

function getInvoiceNotificationConfig(action, invoice, allStaff, adminEmails, creator) {
  if (action !== 'create') return null;

  const recipients = [];
  const salesRepEmails = invoice.commission_splits?.map(s => s.user_email) || 
                         (invoice.sale_agent ? [invoice.sale_agent] : []);

  // Notify sales reps
  salesRepEmails.forEach(email => {
    recipients.push({ email, isAssignee: true });
  });

  // Notify admins
  adminEmails.forEach(email => {
    if (!recipients.find(r => r.email === email)) {
      recipients.push({ email, isAssignee: false });
    }
  });

  return {
    recipients,
    title: '🧾 New Invoice Created',
    message: `Invoice ${invoice.invoice_number} created for ${invoice.customer_name} - $${Number(invoice.amount || 0).toFixed(2)}`,
    emailSubject: `🧾 New Invoice: ${invoice.invoice_number}`,
    type: 'invoice_created',
    linkUrl: `/invoice-details?id=${invoice.id}`
  };
}

async function getPaymentNotificationConfig(action, payment, allStaff, adminEmails, creator, base44) {
  const recipients = [];

  if (action === 'create') {
    console.log('💰 Processing payment CREATE notification');
    console.log('   Payment data:', JSON.stringify(payment));
    console.log('   Admin emails:', adminEmails.join(', '));
    
    // Find assignees from invoice/customer
    let assigneeEmails = [];

    // Look up from invoice
    if (payment.invoice_number) {
      console.log('   Looking up invoice:', payment.invoice_number);
      try {
        const invoices = await base44.asServiceRole.entities.Invoice.filter({ 
          invoice_number: payment.invoice_number,
          company_id: payment.company_id 
        });
        console.log('   Found invoices:', invoices.length);
        if (invoices[0]) {
          const invoice = invoices[0];
          if (invoice.commission_splits?.length > 0) {
            assigneeEmails.push(...invoice.commission_splits.map(s => s.user_email));
            console.log('   Added commission split assignees:', invoice.commission_splits.map(s => s.user_email).join(', '));
          } else if (invoice.sale_agent) {
            assigneeEmails.push(invoice.sale_agent);
            console.log('   Added sale agent:', invoice.sale_agent);
          }
        }
      } catch (e) {
        console.error('   ❌ Failed to fetch invoice:', e);
      }
    }

    // Look up from customer
    if (payment.customer_name) {
      console.log('   Looking up customer:', payment.customer_name);
      try {
        const customers = await base44.asServiceRole.entities.Customer.filter({ 
          name: payment.customer_name,
          company_id: payment.company_id 
        });
        console.log('   Found customers:', customers.length);
        if (customers[0]) {
          if (customers[0].assigned_to_users?.length > 0) {
            assigneeEmails.push(...customers[0].assigned_to_users);
            console.log('   Added customer assignees:', customers[0].assigned_to_users.join(', '));
          } else if (customers[0].assigned_to) {
            assigneeEmails.push(customers[0].assigned_to);
            console.log('   Added customer assignee:', customers[0].assigned_to);
          }
        }
      } catch (e) {
        console.error('   ❌ Failed to fetch customer:', e);
      }
    }

    assigneeEmails = [...new Set(assigneeEmails)];
    console.log('   Final assignee emails:', assigneeEmails.join(', '));

    // Add assignees
    assigneeEmails.forEach(email => {
      recipients.push({ email, isAssignee: true });
    });

    // Notify admins
    adminEmails.forEach(email => {
      if (!recipients.find(r => r.email === email)) {
        recipients.push({ email, isAssignee: false });
      }
    });

    console.log('   📧 Final recipients:', recipients.map(r => `${r.email} (${r.isAssignee ? 'assignee' : 'admin'})`).join(', '));

    return {
      recipients,
      title: '💰 Payment Received',
      message: `$${Number(payment.amount || 0).toFixed(2)} payment from ${payment.customer_name}`,
      emailSubject: `💰 Payment Received: $${payment.amount}`,
      type: 'payment_received',
      linkUrl: '/Payments'
    };
  }

  if (action === 'delete') {
    console.log(`🗑️ Processing payment deletion - admins: ${adminEmails.join(', ')}`);
    
    // Notify ALL admins when payment is deleted
    adminEmails.forEach(email => {
      recipients.push({ email, isAssignee: false });
    });

    console.log(`📧 Deletion recipients: ${recipients.map(r => r.email).join(', ')}`);

    return {
      recipients,
      title: '🗑️ Payment Deleted',
      message: `${payment.payment_number} ($${payment.amount} from ${payment.customer_name}) was deleted by ${creator.full_name || creator.email}`,
      emailSubject: `🗑️ Payment Deleted: ${payment.payment_number}`,
      type: 'payment_deleted',
      linkUrl: '/Payments'
    };
  }

  return null;
}

function getEstimateNotificationConfig(action, estimate, allStaff, adminEmails, creator) {
  if (action !== 'create') return null;

  const recipients = [];

  // Notify admins only for estimates
  adminEmails.forEach(email => {
    recipients.push({ email, isAssignee: false });
  });

  return {
    recipients,
    title: '📄 New Estimate Created',
    message: `Estimate ${estimate.estimate_number} for ${estimate.customer_name} - $${Number(estimate.amount || 0).toFixed(2)}`,
    emailSubject: `📄 New Estimate: ${estimate.estimate_number}`,
    type: 'estimate_created',
    linkUrl: `/EstimateEditor?estimate_id=${estimate.id}`
  };
}

function getLeadNotificationConfig(action, lead, allStaff, adminEmails, creator) {
  if (action !== 'create') return null;

  const recipients = [];
  const assigneeEmails = lead.assigned_to_users || (lead.assigned_to ? [lead.assigned_to] : []);

  // Notify assignees
  assigneeEmails.forEach(email => {
    recipients.push({ email, isAssignee: true });
  });

  // Notify admins
  adminEmails.forEach(email => {
    if (!recipients.find(r => r.email === email)) {
      recipients.push({ email, isAssignee: false });
    }
  });

  return {
    recipients,
    title: '🎯 New Lead Created',
    message: `New lead: ${lead.name}${lead.source ? ` from ${lead.source}` : ''}`,
    emailSubject: `🎯 New Lead: ${lead.name}`,
    type: 'lead_created',
    linkUrl: `/LeadProfile?id=${lead.id}`
  };
}

function getTaskNotificationConfig(action, task, allStaff, adminEmails, creator) {
  if (action === 'create') {
    const assigneeEmails = task.assignees?.map(a => a.email) || 
                          (task.assigned_to ? [task.assigned_to] : []);

    const recipients = assigneeEmails.map(email => ({ email, isAssignee: true }));

    return {
      recipients,
      title: '📋 New Task Assigned',
      message: `You've been assigned: ${task.name}`,
      emailSubject: `📋 Task Assigned: ${task.name}`,
      type: 'task_assigned',
      linkUrl: '/Tasks'
    };
  }

  return null;
}

/**
 * Generate beautiful HTML email
 */
function generateEmailHTML(title, message, entityType, entityData, company, creator, linkUrl, isAssignee) {
  const badge = isAssignee ? '<span class="badge">✅ ASSIGNED TO YOU</span>' : '';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .highlight-box { background: ${isAssignee ? '#dbeafe' : '#f3f4f6'}; border-left: 4px solid ${isAssignee ? '#3b82f6' : '#6b7280'}; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .table th { background: #f3f4f6; padding: 10px; text-align: left; font-weight: 600; }
    .table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; border-radius: 0 0 10px 10px; margin-top: 20px; font-size: 14px; }
    .badge { display: inline-block; padding: 6px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #dbeafe; color: #1e40af; margin-bottom: 10px; }
    .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    ${company?.logo_url ? `<img src="${company.logo_url}" alt="${company.company_name}" style="max-width: 120px; margin-bottom: 10px;">` : ''}
    <h1>${title}</h1>
  </div>
  
  <div class="content">
    ${badge}
    <div class="highlight-box">
      <p style="margin: 0; font-size: 16px; color: #374151;">${message}</p>
    </div>
    
    ${renderEntityDetails(entityType, entityData)}
    
    <p style="margin-top: 30px; color: #666; font-size: 14px;">
      <strong>Created by:</strong> ${creator.full_name || creator.email}
    </p>
  </div>
  
  <div class="footer">
    <p style="margin: 5px 0;"><strong>${company?.company_name || 'CRM'}</strong></p>
    ${company?.phone ? `<p style="margin: 5px 0;">📞 ${company.phone}</p>` : ''}
    ${company?.email ? `<p style="margin: 5px 0;">📧 ${company.email}</p>` : ''}
  </div>
</body>
</html>`;
}

function renderEntityDetails(entityType, data) {
  switch (entityType) {
    case 'Customer':
      return `
        <h3>Customer Details:</h3>
        <table class="table">
          ${data.email ? `<tr><th>Email</th><td><a href="mailto:${data.email}">${data.email}</a></td></tr>` : ''}
          ${data.phone ? `<tr><th>Phone</th><td><a href="tel:${data.phone}">${data.phone}</a></td></tr>` : ''}
          ${data.street || data.address ? `<tr><th>Address</th><td>${data.street || data.address}</td></tr>` : ''}
          ${data.source ? `<tr><th>Source</th><td>${data.source}</td></tr>` : ''}
          ${data.customer_type ? `<tr><th>Type</th><td>${data.customer_type}</td></tr>` : ''}
        </table>
      `;
    
    case 'Invoice':
      return `
        <h3>Invoice Details:</h3>
        <table class="table">
          <tr><th>Customer</th><td>${data.customer_name}</td></tr>
          <tr><th>Amount</th><td style="font-size: 18px; font-weight: 600; color: #16a34a;">$${Number(data.amount || 0).toFixed(2)}</td></tr>
          ${data.due_date ? `<tr><th>Due Date</th><td>${data.due_date}</td></tr>` : ''}
          ${data.status ? `<tr><th>Status</th><td>${data.status}</td></tr>` : ''}
        </table>
      `;
    
    case 'Payment':
      return `
        <h3>Payment Details:</h3>
        <table class="table">
          <tr><th>Customer</th><td>${data.customer_name}</td></tr>
          <tr><th>Amount</th><td style="font-size: 18px; font-weight: 600; color: #16a34a;">$${Number(data.amount || 0).toFixed(2)}</td></tr>
          ${data.payment_method ? `<tr><th>Method</th><td>${data.payment_method}</td></tr>` : ''}
          ${data.invoice_number ? `<tr><th>Invoice</th><td>${data.invoice_number}</td></tr>` : ''}
        </table>
      `;
    
    case 'Lead':
      return `
        <h3>Lead Details:</h3>
        <table class="table">
          ${data.email ? `<tr><th>Email</th><td><a href="mailto:${data.email}">${data.email}</a></td></tr>` : ''}
          ${data.phone ? `<tr><th>Phone</th><td><a href="tel:${data.phone}">${data.phone}</a></td></tr>` : ''}
          ${data.source ? `<tr><th>Source</th><td>${data.source}</td></tr>` : ''}
          ${data.status ? `<tr><th>Status</th><td>${data.status}</td></tr>` : ''}
        </table>
      `;
    
    case 'Estimate':
      return `
        <h3>Estimate Details:</h3>
        <table class="table">
          <tr><th>Customer</th><td>${data.customer_name}</td></tr>
          <tr><th>Amount</th><td style="font-size: 18px; font-weight: 600; color: #16a34a;">$${Number(data.amount || 0).toFixed(2)}</td></tr>
          ${data.status ? `<tr><th>Status</th><td>${data.status}</td></tr>` : ''}
        </table>
      `;
    
    case 'Task':
      return `
        <h3>Task Details:</h3>
        <table class="table">
          ${data.description ? `<tr><th>Description</th><td>${data.description}</td></tr>` : ''}
          ${data.due_date ? `<tr><th>Due Date</th><td>${data.due_date}</td></tr>` : ''}
          ${data.priority ? `<tr><th>Priority</th><td>${data.priority}</td></tr>` : ''}
        </table>
      `;
    
    default:
      return '';
  }
}