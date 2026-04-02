import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const requestBody = await req.json();
    const { 
      companyId, 
      notificationType, 
      recipientEmail, 
      recipientName,
      data 
    } = requestBody;

    console.log('📧 Sending notification:', notificationType, 'to:', recipientEmail);

    // Get company info
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];

    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get email template
    const templates = await base44.asServiceRole.entities.EmailTemplate.filter({
      company_id: companyId,
      category: getCategoryForNotification(notificationType),
      is_active: true
    });

    let template = templates.find(t => t.template_name.toLowerCase().includes(notificationType.toLowerCase()));
    
    // If no custom template, use default
    if (!template) {
      template = getDefaultTemplate(notificationType, company, data);
    }

    // Replace merge fields
    let subject = replaceMergeFields(template.subject || getDefaultSubject(notificationType), data, company);
    let emailBody = replaceMergeFields(template.body || getDefaultBody(notificationType, data, company), data, company);

    console.log('✅ Sending email:', subject);

    // Send email using Unified Email System
    const emailRes = await base44.functions.invoke('sendUnifiedEmail', {
      to: recipientEmail,
      subject: subject,
      html: emailBody,
      companyId: companyId,
      contactName: recipientName,
      messageType: 'notification',
      skipLogging: false // Notifications should be logged
    });

    if (emailRes.data?.error) {
      throw new Error(emailRes.data.error);
    }

    console.log('✅ Email sent successfully');

    return Response.json({ 
      success: true,
      message: 'Notification sent',
      id: emailRes.data?.id
    });

  } catch (error) {
    console.error('❌ Error sending notification:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});

function getCategoryForNotification(type) {
  if (type.includes('lead')) return 'leads';
  if (type.includes('customer')) return 'customers';
  if (type.includes('estimate')) return 'estimates';
  if (type.includes('invoice')) return 'invoices';
  if (type.includes('payment')) return 'payments';
  if (type.includes('task')) return 'tasks';
  if (type.includes('project')) return 'projects';
  return 'general';
}

function getDefaultSubject(type) {
  const subjects = {
    'lead_created': 'New Lead: {lead_name}',
    'lead_converted': 'Lead Converted: {lead_name} → {customer_name}',
    'customer_created': 'New Customer: {customer_name}',
    'estimate_created': 'New Estimate: {estimate_number}',
    'estimate_sent': 'Estimate {estimate_number} Sent',
    'estimate_accepted': '✅ Estimate Accepted: {estimate_number}',
    'estimate_declined': '❌ Estimate Declined: {estimate_number}',
    'invoice_created': 'New Invoice: {invoice_number}',
    'invoice_sent': 'Invoice {invoice_number}',
    'invoice_paid': '💰 Payment Received: {invoice_number}',
    'payment_received': 'Payment Received: ${amount}',
    'task_assigned': 'Task Assigned: {task_name}',
    'task_comment': 'Comment on Task: {task_name}',
    'project_status': 'Project Update: {project_name}',
    'appointment_reminder': 'Reminder: {event_title} in 1 hour',
    'contract_signed': '✅ Contract Signed: {contract_name}'
  };
  return subjects[type] || 'Notification from {company_name}';
}

function getDefaultBody(type, data, company) {
  const templates = {
    'lead_created': `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #3b82f6;">New Lead Created</h2>
  <p>A new lead has been added to your CRM:</p>
  <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <strong>Name:</strong> {lead_name}<br>
    <strong>Email:</strong> {lead_email}<br>
    <strong>Phone:</strong> {lead_phone}<br>
    <strong>Source:</strong> {lead_source}<br>
    <strong>Status:</strong> {lead_status}
  </div>
  <p><a href="{app_url}" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Lead</a></p>
</div>`,

    'estimate_created': `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #10b981;">New Estimate Created</h2>
  <p>A new estimate has been created:</p>
  <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <strong>Estimate #:</strong> {estimate_number}<br>
    <strong>Customer:</strong> {customer_name}<br>
    <strong>Amount:</strong> ${amount}<br>
    <strong>Valid Until:</strong> {valid_until}
  </div>
  <p><a href="{app_url}" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Estimate</a></p>
</div>`,

    'task_comment': `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #8b5cf6;">New Comment on Task</h2>
  <p>A comment has been made on the following task:</p>
  <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <strong>Task:</strong> {task_name}<br>
    <strong>Comment by:</strong> {commenter_name}<br>
    <strong>Comment:</strong><br>
    <div style="background: white; padding: 10px; margin-top: 10px; border-left: 3px solid #8b5cf6;">
      {comment_text}
    </div>
  </div>
  <p><a href="{app_url}" style="background: #8b5cf6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Task</a></p>
</div>`,

    'invoice_paid': `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #10b981;">💰 Payment Received!</h2>
  <p>Great news! A payment has been received:</p>
  <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <strong>Invoice #:</strong> {invoice_number}<br>
    <strong>Customer:</strong> {customer_name}<br>
    <strong>Amount Paid:</strong> <span style="color: #10b981; font-size: 24px; font-weight: bold;">${amount}</span><br>
    <strong>Payment Method:</strong> {payment_method}<br>
    <strong>Date:</strong> {payment_date}
  </div>
  <p><a href="{app_url}" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Invoice</a></p>
</div>`
  };

  return templates[type] || `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Notification from {company_name}</h2>
  <p>You have a new notification.</p>
  <p><a href="{app_url}" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View in CRM</a></p>
</div>`;
}

function replaceMergeFields(text, data, company) {
  let result = text;
  
  // Company fields
  result = result.replace(/{company_name}/g, company.company_name || 'AI CRM Pro');
  result = result.replace(/{app_url}/g, 'https://getcompanysync.com' || 'https://getcompanysync.com');
  
  // Data fields
  if (data) {
    Object.keys(data).forEach(key => {
      const regex = new RegExp(`{${key}}`, 'g');
      result = result.replace(regex, data[key] || '');
    });
  }
  
  return result;
}

function getDefaultTemplate(type, company, data) {
  return {
    subject: getDefaultSubject(type),
    body: getDefaultBody(type, data, company)
  };
}