import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all companies
    const companies = await base44.asServiceRole.entities.Company.filter({ is_deleted: { $ne: true } });
    
    const results = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const company of companies) {
      // Get subcontractors with insurance expiration dates
      const subcontractors = await base44.asServiceRole.entities.Subcontractor.filter({
        company_id: company.id,
        is_active: true,
        insurance_expiration: { $exists: true, $ne: null }
      });
      
      // Get company's Twilio settings
      const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({
        company_id: company.id
      });
      const twilioConfig = twilioSettings[0];
      
      for (const sub of subcontractors) {
        if (!sub.insurance_expiration || !sub.phone) continue;
        
        const expirationDate = new Date(sub.insurance_expiration);
        expirationDate.setHours(0, 0, 0, 0);
        
        const daysUntilExpiration = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
        
        let reminderType = null;
        if (daysUntilExpiration === 30) reminderType = '30_day';
        else if (daysUntilExpiration === 7) reminderType = '7_day';
        else if (daysUntilExpiration === 1) reminderType = '1_day';
        else if (daysUntilExpiration <= 0) reminderType = 'expired';
        
        if (!reminderType) continue;
        
        // Check if we already sent this reminder (stored in notes)
        const reminderKey = `insurance_reminder_${reminderType}_${sub.insurance_expiration}`;
        if (sub.notes && sub.notes.includes(reminderKey)) continue;
        
        const messages = getMessages(sub, daysUntilExpiration, reminderType, company.company_name);
        
        // Send SMS
        if (twilioConfig?.account_sid && twilioConfig?.auth_token && twilioConfig?.phone_number) {
          try {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.account_sid}/Messages.json`;
            const smsResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${twilioConfig.account_sid}:${twilioConfig.auth_token}`),
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                To: sub.phone,
                From: twilioConfig.phone_number,
                Body: messages.sms
              })
            });
            
            if (smsResponse.ok) {
              results.push({ subcontractor: sub.name, type: 'sms', reminderType, status: 'sent' });
            }
          } catch (e) {
            results.push({ subcontractor: sub.name, type: 'sms', reminderType, status: 'failed', error: e.message });
          }
        }
        
        // Send Email
        if (sub.email) {
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: sub.email,
              subject: messages.emailSubject,
              body: messages.emailBody
            });
            results.push({ subcontractor: sub.name, type: 'email', reminderType, status: 'sent' });
          } catch (e) {
            results.push({ subcontractor: sub.name, type: 'email', reminderType, status: 'failed', error: e.message });
          }
        }
        
        // Mark reminder as sent
        const newNotes = (sub.notes || '') + `\n[${reminderKey}] Sent ${new Date().toISOString()}`;
        await base44.asServiceRole.entities.Subcontractor.update(sub.id, { notes: newNotes.trim() });
      }
    }
    
    return Response.json({ 
      success: true, 
      checked: companies.length,
      reminders: results 
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getMessages(sub, daysUntilExpiration, reminderType, companyName) {
  const contactName = sub.contact_person || sub.name;
  const expDate = sub.insurance_expiration;
  
  const templates = {
    '30_day': {
      sms: `Hi ${contactName}, this is ${companyName}. Your insurance expires on ${expDate} (30 days). Please send us your updated certificate of insurance. Thanks!`,
      emailSubject: 'Insurance Expiring Soon - Action Required',
      emailBody: `Hi ${contactName},\n\nThis is a friendly reminder that your insurance certificate on file with ${companyName} will expire on ${expDate} (in approximately 30 days).\n\nTo ensure uninterrupted work assignments, please send us your updated Certificate of Insurance (COI) at your earliest convenience.\n\nThank you for your continued partnership!\n\nBest regards,\n${companyName}`
    },
    '7_day': {
      sms: `REMINDER: ${contactName}, your insurance expires in 7 days (${expDate}). We need your updated COI ASAP to keep you on our active roster. - ${companyName}`,
      emailSubject: '⚠️ URGENT: Insurance Expires in 7 Days',
      emailBody: `Hi ${contactName},\n\nYour insurance certificate expires in 7 days on ${expDate}.\n\nAction Required: Please send us your updated Certificate of Insurance immediately to avoid any interruption in work assignments.\n\nWithout current insurance documentation, we will not be able to assign you to any jobs after the expiration date.\n\nBest regards,\n${companyName}`
    },
    '1_day': {
      sms: `FINAL NOTICE: ${contactName}, your insurance expires TOMORROW (${expDate}). Without updated COI, we cannot use your services. Please send immediately! - ${companyName}`,
      emailSubject: '🚨 FINAL NOTICE: Insurance Expires Tomorrow!',
      emailBody: `Hi ${contactName},\n\nThis is your final reminder that your insurance expires TOMORROW (${expDate}).\n\nWithout an updated Certificate of Insurance, we will be unable to assign you any work starting tomorrow.\n\nPlease send your updated COI immediately to continue working with us.\n\nBest regards,\n${companyName}`
    },
    'expired': {
      sms: `${contactName}, your insurance has EXPIRED. Your services are temporarily suspended until we receive your updated COI. Please send ASAP. - ${companyName}`,
      emailSubject: '🛑 Insurance Expired - Services Suspended',
      emailBody: `Hi ${contactName},\n\nUnfortunately, your insurance certificate has expired.\n\nYour services have been temporarily suspended until we receive your updated Certificate of Insurance.\n\nPlease send your renewed COI as soon as possible so we can reinstate you to our active subcontractor roster.\n\nWe value our partnership and look forward to working with you again once your insurance is current.\n\nBest regards,\n${companyName}`
    }
  };
  
  return templates[reminderType];
}