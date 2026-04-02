import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId } = await req.json();

    if (!companyId) {
      return Response.json({ error: 'Company ID required' }, { status: 400 });
    }

    console.log('🔄 Setting up default workflows for company:', companyId);

    // Define all default workflows
    const workflows = [
      {
        workflow_name: "Quote Request Automation",
        description: "Streamlines the estimate process when AI detects someone asking about pricing, estimates, or 'how much' questions",
        trigger_type: "ai_communication_logged",
        trigger_conditions: {"field":"intent","value":"get_quote|pricing|estimate|how much|cost","operator":"contains"},
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Emergency Response - Urgent Situations",
        description: "Immediately alerts your team when AI detects emergency situations (storms, leaks, urgent damage)",
        trigger_type: "ai_communication_logged",
        trigger_conditions: {"field":"keywords","value":"emergency|urgent|leak|storm damage|flooding|hole in roof","operator":"contains"},
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Hot Lead - Immediate Follow-up",
        description: "Automatically responds when AI detects a high-intent lead",
        trigger_type: "ai_communication_logged",
        trigger_conditions: {"value":"get_quote|positive|interested","field":"intent_or_sentiment","operator":"contains"},
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "New Estimate Follow-up",
        description: "Automatically follow up with customers who receive estimates",
        trigger_type: "estimate_created",
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Hot Lead Alert",
        description: "Notify team when a lead becomes hot",
        trigger_type: "lead_created",
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Invoice Payment Reminder",
        description: "Remind customers about overdue invoices",
        trigger_type: "invoice_overdue",
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Estimate Accepted - Create Invoice",
        description: "When customer accepts estimate, send thank you and create invoice",
        trigger_type: "estimate_accepted",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"{customer_email}","email_subject":"Thank you! Your project is confirmed","email_body":"<p>Hi {customer_name},</p><p>Great news! We've received your acceptance of estimate {estimate_number}.</p><p>We'll send you an invoice shortly and get started on your project.</p><p>Thank you for choosing {company_name}!</p><p>Best regards,<br/>Your team</p>"},
          {"step":2,"action_type":"create_task","schedule_type":"delay","delay_minutes":0,"recipient":"{created_by}","task_title":"Create invoice for {customer_name}","task_description":"Customer accepted estimate {estimate_number}. Create and send invoice."}
        ]
      },
      {
        workflow_name: "Estimate Follow-up Sequence",
        description: "Automatically follow up with customers after sending an estimate",
        trigger_type: "estimate_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"wait","schedule_type":"delay","delay_minutes":2880},
          {"step":2,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"customer","email_subject":"Following up on Estimate {estimate_number}","email_body":"<p>Hi {customer_name},</p><p>Just wanted to follow up on the estimate we sent you for {project_name}.</p><p>Do you have any questions? We're here to help!</p><p>Best regards,<br/>{company_name}</p>"},
          {"step":3,"action_type":"wait","schedule_type":"delay","delay_minutes":2880},
          {"step":4,"action_type":"create_task","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com","task_title":"Follow up on estimate","task_description":"Customer hasn't responded to estimate after 3 days"}
        ]
      },
      {
        workflow_name: "Emergency Storm Response",
        description: "Reach out to customers after major storms in their area",
        trigger_type: "lead_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"lead","email_subject":"🚨 Storm Damage? {company_name} is Here to Help!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>🚨 Storm Emergency Response</h1></div><div style='padding: 30px 20px;'><h2 style='color: #333;'>Hi {lead_name},</h2><p style='font-size: 16px; line-height: 1.6; color: #555;'>We noticed severe weather hit {service_area} recently. We're here to help!</p><div style='background: #fee2e2; border-left: 4px solid #dc2626; padding: 20px; margin: 25px 0;'><h3 style='margin-top: 0; color: #991b1b;'>We Offer:</h3><ul style='margin: 0; padding-left: 20px;'><li>🆓 FREE Emergency Inspections</li><li>⚡ 24/7 Emergency Service</li><li>📋 Insurance Claim Assistance</li><li>🛡️ Temporary Repairs Available</li><li>💰 Direct Insurance Billing</li></ul></div><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #dc2626; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Schedule FREE Inspection</a></div><p style='font-size: 14px; color: #666;'>EMERGENCY HOTLINE: {company_phone} (24/7)</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":30,"recipient":"lead","sms_message":"🚨 Storm damage in {service_area}? {company_name} offers FREE inspections + insurance help. Call 24/7: {company_phone}"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":60,"recipient":"yicnteam@gmail.com","task_title":"🚨 URGENT: Storm Lead - {lead_name}","task_description":"STORM EMERGENCY LEAD\\n\\nLead: {lead_name}\\nArea: {service_area}\\nSource: Storm Tracker\\n\\nHIGH PRIORITY:\\n- Call within 1 hour\\n- Offer FREE inspection TODAY\\n- Mention insurance assistance\\n- Schedule ASAP (strike while hot!)\\n\\nTips:\\n- Be empathetic about storm damage\\n- Emphasize quick response\\n- Mention we work with insurance\\n- Offer temporary repairs if needed"}
        ]
      },
      {
        workflow_name: "Service Anniversary Check-In",
        description: "Check in with customers 1 year after service",
        trigger_type: "project_completed",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":525600,"recipient":"customer","email_subject":"Happy 1-Year Anniversary from {company_name}! 🎉","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 32px;'>🎉 Happy Anniversary! 🎉</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>It's been one year since we completed your roofing project! We hope everything is still looking great.</p><div style='background: #faf5ff; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center;'><h3 style='margin-top: 0; color: #6b21a8;'>🎁 Anniversary Special!</h3><p style='font-size: 18px; font-weight: bold; color: #6b21a8;'>20% OFF</p><p>Any Additional Service or Repair</p><p style='font-size: 14px; color: #666;'>Valid for 30 days</p></div><div style='background: #dbeafe; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #1e40af;'>How's Your Roof?</h3><p>We'd love to do a complimentary 1-year inspection to make sure everything is perfect!</p><div style='text-align: center; margin-top: 15px;'><a href='{schedule_link}' style='display: inline-block; background: #8b5cf6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Schedule Free Inspection</a></div></div><p style='font-size: 14px; color: #666;'>Questions? Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":527040,"recipient":"customer","sms_message":"🎉 1 year anniversary! {company_name} wants to offer you 20% OFF + FREE inspection. Book: {schedule_link} Call: {company_phone}"}
        ]
      },
      {
        workflow_name: "Project Completion Follow-Up",
        description: "Thank customer, request review, and ask for referrals after project completion",
        trigger_type: "project_completed",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":1440,"recipient":"customer","email_subject":"Thank You from {company_name}! How Did We Do?","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>Project Complete! 🎉</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>Thank you for trusting {company_name} with your roofing project! We hope you love the results.</p><div style='background: #d1fae5; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center;'><h3 style='margin-top: 0; color: #065f46;'>How Did We Do?</h3><p>Your feedback helps us improve and helps others make informed decisions!</p><div style='margin: 20px 0;'><a href='{reviews_link}' style='display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>⭐ Leave a Review</a></div></div><div style='background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #92400e;'>🎁 Refer a Friend, Earn $100!</h3><p>Know someone who needs roofing work? Refer them and you both save!</p></div><p style='font-size: 14px; color: #666;'>Questions about your warranty? Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":4320,"recipient":"customer","sms_message":"Hi {customer_name}! Hope you're loving your new roof! 😊 Quick favor - leave us a review? {reviews_link} Thanks! -{company_name}"},
          {"step":3,"action_type":"send_email","schedule_type":"delay","delay_minutes":10080,"recipient":"customer","email_subject":"Love Your New Roof? Share the Love! $100 Referral Bonus","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: #6366f1; padding: 30px 20px; text-align: center;'><h1 style='color: white; margin: 0;'>Earn $100 Per Referral!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>We're so glad you chose {company_name}! Now help your friends get the same great service.</p><div style='background: #eef2ff; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center;'><h3 style='color: #3730a3; margin-top: 0;'>💰 Referral Program 💰</h3><p style='font-size: 18px;'><strong>You earn $100</strong> for every friend who books with us!</p><p style='font-size: 18px;'><strong>They save $100</strong> off their project!</p><p style='margin-top: 20px;'>Win-Win! 🎉</p></div><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #6366f1; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Refer a Friend Now</a></div></div></div>"}
        ]
      },
      {
        workflow_name: "Post-Inspection Follow-Up",
        description: "Follow up after free inspections to convert to estimates",
        trigger_type: "appointment_completed",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":60,"recipient":"customer","email_subject":"Thanks for Meeting with {company_name}!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: #3b82f6; padding: 30px 20px; text-align: center;'><h1 style='color: white; margin: 0;'>Thank You!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>Thank you for allowing us to inspect your property today! We appreciate your time.</p><div style='background: #dbeafe; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #1e40af;'>Next Steps</h3><p>We're preparing your detailed estimate and will have it ready within 24 hours.</p></div><p style='font-size: 16px; line-height: 1.6;'>In the meantime, feel free to check out our recent projects and 5-star reviews!</p><div style='text-align: center; margin: 30px 0;'><a href='{portfolio_link}' style='display: inline-block; background: #3b82f6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px;'>View Portfolio</a><a href='{reviews_link}' style='display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Read Reviews</a></div></div></div>"},
          {"step":2,"action_type":"create_task","schedule_type":"delay","delay_minutes":120,"recipient":"yicnteam@gmail.com","task_title":"Create Estimate for {customer_name}","task_description":"POST-INSPECTION ESTIMATE NEEDED\\n\\nCustomer: {customer_name}\\nInspection completed\\n\\nTO-DO:\\n- Review inspection notes\\n- Create detailed estimate\\n- Include photos from inspection\\n- Send estimate within 24 hours"},
          {"step":3,"action_type":"send_sms","schedule_type":"delay","delay_minutes":1440,"recipient":"customer","sms_message":"Hi {customer_name}! Your estimate from {company_name} is ready. Check your email or call {company_phone} to discuss!"}
        ]
      },
      {
        workflow_name: "Seasonal Maintenance Reminder",
        description: "Remind customers about seasonal roof maintenance",
        trigger_type: "customer_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":129600,"recipient":"customer","email_subject":"Time for Your Free Roof Inspection! - {company_name}","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>🏠 Roof Maintenance Time!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>It's been 90 days since we completed your roof. Time for a quick check-up!</p><div style='background: #dbeafe; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #1e40af;'>Why Seasonal Inspections Matter:</h3><ul style='margin: 0; padding-left: 20px;'><li>🍂 Catch small issues before they become big problems</li><li>💰 Protect your warranty coverage</li><li>🛡️ Extend your roof's lifespan</li><li>✅ 100% FREE for our customers!</li></ul></div><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #3b82f6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Schedule Free Inspection</a></div><p style='font-size: 14px; color: #666;'>Takes just 30 minutes! Call {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":131040,"recipient":"customer","sms_message":"Hi {customer_name}! Time for your FREE seasonal roof inspection from {company_name}. Book now: {schedule_link} or call {company_phone}"}
        ]
      },
      {
        workflow_name: "Referral Request After Payment",
        description: "Ask for referrals after customer pays invoice",
        trigger_type: "payment_received",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":4320,"recipient":"customer","email_subject":"Love Your Experience? Earn $100 Per Referral! 💰","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>💰 Earn $100 Cash! 💰</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>We hope you loved working with {company_name}! Now help your friends and earn cash!</p><div style='background: #d1fae5; padding: 30px; border-radius: 8px; margin: 25px 0; text-align: center; border: 3px dashed #10b981;'><h3 style='margin-top: 0; color: #065f46; font-size: 24px;'>🎁 REFERRAL PROGRAM 🎁</h3><div style='margin: 25px 0;'><p style='font-size: 20px; font-weight: bold; color: #065f46; margin: 10px 0;'>You Get: $100 Cash</p><p style='font-size: 20px; font-weight: bold; color: #065f46; margin: 10px 0;'>They Get: $100 Off</p></div><p style='font-size: 14px; color: #065f46;'>UNLIMITED referrals - the more you refer, the more you earn!</p></div><div style='background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #92400e;'>How It Works:</h3><ol style='text-align: left; padding-left: 20px;'><li>Share {company_name} with friends/family</li><li>They mention your name when booking</li><li>We complete their project</li><li>You get $100 (check or Venmo)!</li></ol></div><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px;'>Refer a Friend Now</a></div><p style='font-size: 14px; color: #666; text-align: center;'>Questions? Call {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":7200,"recipient":"customer","sms_message":"💰 Earn $100 for EVERY friend you refer to {company_name}! Unlimited referrals. Share now: {schedule_link}"}
        ]
      },
      {
        workflow_name: "Lost Lead Win-Back Campaign",
        description: "One last attempt to win back leads marked as lost",
        trigger_type: "lead_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":20160,"recipient":"lead","email_subject":"One Last Chance - Special Offer from {company_name}","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>We Want to Earn Your Business!</h1></div><div style='padding: 30px 20px;'><h2>Hi {lead_name},</h2><p style='font-size: 16px; line-height: 1.6;'>We understand you went with another contractor, but we'd love one more chance to prove our value!</p><div style='background: #fef3c7; border: 2px dashed #f59e0b; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center;'><h3 style='margin-top: 0; color: #92400e; font-size: 24px;'>🎁 EXCLUSIVE OFFER 🎁</h3><p style='font-size: 18px; font-weight: bold; color: #92400e;'>10% OFF</p><p>Your Entire Project - Valid for 7 Days Only!</p></div><p style='font-size: 16px; line-height: 1.6;'>Why give us another look?</p><ul><li>⭐ 4.9/5 stars on Google (200+ reviews)</li><li>🏆 {years_in_business}+ years in business</li><li>✅ {certifications}</li><li>💰 Price match guarantee</li></ul><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #f59e0b; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Claim Your 10% Discount</a></div></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":20880,"recipient":"lead","sms_message":"Last chance! {company_name} offering 10% OFF just for you. 7 days only. Save $$$ - call now: {company_phone}"}
        ]
      },
      {
        workflow_name: "Abandoned Estimate Recovery",
        description: "Win back customers who viewed but did not accept estimates",
        trigger_type: "estimate_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":10080,"recipient":"customer","email_subject":"Still Thinking About Your Roofing Project? Let's Talk!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: #8b5cf6; padding: 30px 20px; text-align: center;'><h1 style='color: white; margin: 0;'>We Miss You!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>We noticed you haven't moved forward with your estimate yet. We'd love to help!</p><div style='background: #faf5ff; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #6b21a8;'>Have Questions?</h3><p>Common concerns we can address:</p><ul><li>💰 Pricing and payment options</li><li>📅 Project timeline flexibility</li><li>🛡️ Warranty coverage details</li><li>📋 Material upgrades available</li></ul></div><p style='font-size: 16px; line-height: 1.6;'><strong>Special Offer:</strong> Schedule within 3 days and receive 5% off your estimate!</p><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #8b5cf6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Let's Talk - Call Me!</a></div></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":10800,"recipient":"customer","sms_message":"Hi {customer_name}! Still interested in your roofing project? {company_name} offering 5% off if you book this week! {company_phone}"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":11520,"recipient":"yicnteam@gmail.com","task_title":"Win-Back Call: {customer_name}","task_description":"ESTIMATE ABANDONED - WIN BACK\\n\\nCustomer: {customer_name}\\nEstimate: {estimate_number}\\nAmount: {amount}\\nDays Since Estimate: 8\\n\\nRECOVERY STRATEGY:\\n- Call to understand concerns\\n- Address pricing objections\\n- Offer 5% discount (expires soon)\\n- Flexible payment terms\\n- Compare with competitor prices\\n- Highlight unique value props"}
        ]
      },
      {
        workflow_name: "Customer Birthday/Anniversary",
        description: "Send personalized wishes and special offers on special occasions",
        trigger_type: "customer_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":525600,"recipient":"customer","email_subject":"🎂 Happy Birthday from {company_name}! Special Gift Inside","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 36px;'>🎂 HAPPY BIRTHDAY! 🎂</h1></div><div style='padding: 30px 20px; text-align: center;'><h2>Hi {customer_name},</h2><p style='font-size: 18px; line-height: 1.6;'>Wishing you an amazing birthday from all of us at {company_name}!</p><div style='background: #fce7f3; padding: 30px; border-radius: 8px; margin: 30px 0;'><h3 style='color: #9f1239; margin-top: 0; font-size: 24px;'>🎁 YOUR BIRTHDAY GIFT 🎁</h3><p style='font-size: 28px; font-weight: bold; color: #9f1239; margin: 20px 0;'>25% OFF</p><p style='font-size: 16px; color: #9f1239;'>Any Service or Repair</p><p style='font-size: 14px; color: #666; margin-top: 15px;'>Valid for 30 days • Cannot be combined with other offers</p></div><p style='font-size: 16px; line-height: 1.6;'>Need any home improvements? Now's the perfect time!</p><div style='margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #ec4899; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px;'>Claim Your Birthday Gift</a></div><p style='font-size: 14px; color: #666;'>Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":525720,"recipient":"customer","sms_message":"🎂 Happy Birthday {customer_name}! Here's 25% OFF any service from {company_name}. Valid 30 days. Call: {company_phone}"}
        ]
      },
      {
        workflow_name: "Estimate Accepted - Thank You",
        description: "Thank customer and set expectations after estimate acceptance",
        trigger_type: "estimate_accepted",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":null,"email_subject":"Thank You for Choosing {company_name}! 🎉","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>Thank You! 🎉</h1></div><div style='padding: 30px 20px;'><h2 style='color: #333;'>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6; color: #555;'>We're thrilled you chose {company_name} for your roofing project!</p><div style='background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #065f46;'>What Happens Next?</h3><ul style='margin: 0; padding-left: 20px;'><li>📞 We'll call you within 24 hours to schedule</li><li>📅 Project timeline: 3-5 business days</li><li>🔨 Professional crew assigned</li><li>✅ Final walkthrough with you</li></ul></div><p style='font-size: 16px; line-height: 1.6;'>We'll keep you updated every step of the way!</p><p style='font-size: 14px; color: #666;'>Questions? Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":5,"recipient":null,"sms_message":"🎉 Thank you for choosing {company_name}! We'll call you within 24 hours to schedule your project. {company_phone}"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":60,"recipient":null,"task_title":"URGENT: Schedule Project for {customer_name}","task_description":"ESTIMATE ACCEPTED! 🎉\\n\\nCustomer: {customer_name}\\nEstimate: {estimate_number}\\nAmount: {amount}\\n\\nTO-DO:\\n- Call customer ASAP\\n- Schedule project start date\\n- Confirm crew availability\\n- Send calendar invite"}
        ]
      },
      {
        workflow_name: "Review Request Campaign",
        description: "Systematic approach to collect more 5-star reviews",
        trigger_type: "project_completed",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":2880,"recipient":"customer","email_subject":"⭐ We'd Love Your Feedback, {customer_name}!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: #fbbf24; padding: 30px 20px; text-align: center;'><h1 style='color: white; margin: 0;'>⭐⭐⭐⭐⭐</h1><h2 style='color: white; margin: 10px 0 0 0;'>How Did We Do?</h2></div><div style='padding: 30px 20px; text-align: center;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>Your feedback means the world to us! Would you take 60 seconds to share your experience?</p><div style='margin: 30px 0;'><a href='{reviews_link}' style='display: inline-block; background: #fbbf24; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px;'>⭐ Leave a Review</a></div><p style='font-size: 14px; color: #666; margin-top: 30px;'>Your review helps other homeowners make confident decisions!</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":7200,"recipient":"customer","sms_message":"Hi {customer_name}! Quick request - would love if you could leave us a ⭐⭐⭐⭐⭐ review! Takes 60 sec: {reviews_link} Thanks!"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":14400,"recipient":"yicnteam@gmail.com","task_title":"Personal Call: Request Review from {customer_name}","task_description":"REVIEW REQUEST CALL\\n\\nCustomer: {customer_name}\\nProject completed 10 days ago\\nNo review left yet\\n\\nCALL SCRIPT:\\n- Thank them again for their business\\n- Ask how everything is holding up\\n- Mention how much reviews help small businesses\\n- Offer to text them the review link\\n- Be genuine and appreciative"}
        ]
      },
      {
        workflow_name: "Payment Received Thank You",
        description: "Thank customers for timely payment and build loyalty",
        trigger_type: "payment_received",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":60,"recipient":"customer","email_subject":"Payment Received - Thank You! 🎉","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: #10b981; padding: 30px 20px; text-align: center;'><h1 style='color: white; margin: 0;'>Payment Received! ✓</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>Thank you for your payment! We've received {amount} for Invoice #{invoice_number}.</p><div style='background: #d1fae5; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #065f46;'>Payment Details</h3><p style='margin: 5px 0;'><strong>Amount:</strong> {amount}</p><p style='margin: 5px 0;'><strong>Invoice:</strong> #{invoice_number}</p><p style='margin: 5px 0;'><strong>Status:</strong> ✅ PAID IN FULL</p></div><p style='font-size: 16px; line-height: 1.6;'>A receipt has been emailed to you for your records.</p><div style='background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0;'><p style='margin: 0;'><strong>💡 Did You Know?</strong> You can view all your invoices and receipts anytime in your customer portal!</p><div style='text-align: center; margin-top: 15px;'><a href='{portal_link}' style='display: inline-block; background: #f59e0b; color: white; padding: 10px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;'>View Portal</a></div></div><p style='font-size: 14px; color: #666;'>Questions? Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":120,"recipient":"customer","sms_message":"Payment received! Thank you {customer_name}! 🎉 We appreciate your business. -{company_name}"}
        ]
      },
      {
        workflow_name: "New Lead Welcome Sequence",
        description: "Automatically welcome new leads and nurture them over 7 days",
        trigger_type: "lead_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"lead","email_subject":"Welcome to {company_name} - Your Free Inspection Awaits!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; margin: 0; font-size: 28px;'>Welcome to {company_name}!</h1></div><div style='padding: 30px 20px;'><h2 style='color: #333;'>Hi {lead_name},</h2><p style='font-size: 16px; line-height: 1.6; color: #555;'>Thank you for reaching out! We're excited to help with your roofing project.</p><div style='background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 25px 0;'><h3 style='margin-top: 0; color: #1e40af;'>Why Choose Us?</h3><ul style='margin: 0; padding-left: 20px;'><li>⭐ Top Rated in {service_area}</li><li>🏆 Licensed & Insured</li><li>💰 FREE Inspections</li><li>📞 24/7 Emergency Service</li><li>✅ Lifetime Warranty</li></ul></div><div style='text-align: center; margin: 30px 0;'><a href='{schedule_link}' style='display: inline-block; background: #3b82f6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>Schedule Your Free Inspection</a></div><p style='font-size: 14px; color: #666;'>Questions? Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":15,"recipient":"lead","sms_message":"Hi {lead_name}! This is {company_name}. Thanks for your interest! Free inspection available. Call/text {company_phone} 😊"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":1440,"recipient":"yicnteam@gmail.com","task_title":"PRIORITY: Call {lead_name} - New Lead Follow-Up","task_description":"NEW LEAD - Call to schedule free inspection\\n\\nLead: {lead_name}\\nPhone: {lead_phone}\\nEmail: {lead_email}\\n\\nTalk about:\\n- Thank them for interest\\n- Ask about roofing concerns\\n- Emphasize FREE inspection\\n- Schedule within 48 hours"}
        ]
      },
      {
        workflow_name: "Estimate Sent Follow-Up",
        description: "Follow up after sending an estimate to increase conversion",
        trigger_type: "estimate_created",
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"customer","email_subject":"Your {company_name} Estimate #{estimate_number} is Ready!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'><div style='background: #1f2937; padding: 30px 20px; text-align: center;'><h1 style='color: white; margin: 0;'>Your Estimate is Ready!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p style='font-size: 16px; line-height: 1.6;'>Thank you for choosing {company_name}! Your detailed estimate is ready for review.</p><div style='background: #f0fdf4; border-left: 4px solid #10b981; padding: 20px; margin: 25px 0;'><h3 style='margin-top: 0; color: #065f46;'>Estimate Summary</h3><p style='margin: 5px 0;'><strong>Estimate #:</strong> {estimate_number}</p><p style='margin: 5px 0;'><strong>Total Amount:</strong> {amount}</p></div><div style='text-align: center; margin: 30px 0;'><a href='{portal_link}' style='display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;'>View & Accept Estimate</a></div><p style='font-size: 14px; color: #666;'>Questions? Call us at {company_phone}</p></div></div>"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":1440,"recipient":"customer","sms_message":"Hi {customer_name}! Did you get a chance to review your estimate from {company_name}? Any questions? {company_phone}"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":4320,"recipient":"yicnteam@gmail.com","task_title":"Follow Up: {customer_name} - Estimate #{estimate_number}","task_description":"ESTIMATE FOLLOW-UP\\n\\nCustomer: {customer_name}\\nEstimate: {estimate_number}\\nAmount: {amount}\\n\\nAction Items:\\n- Call to discuss estimate\\n- Answer any questions\\n- Address concerns\\n- Try to close the deal"}
        ]
      },
      {
        workflow_name: "New Proposal Created",
        description: "Notify when a new proposal is created",
        trigger_type: "proposal_created",
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Proposal Accepted",
        description: "Notify when a proposal is accepted",
        trigger_type: "proposal_accepted",
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Inspection Completed Alert",
        description: "Notify when drone inspection is completed with AI analysis",
        trigger_type: "inspection_completed",
        company_id: companyId,
        is_active: true,
        actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"yicnteam@gmail.com"}]
      },
      {
        workflow_name: "Send Inspection Assignment Notifications",
        description: "Automatically send email and SMS to inspector and client when inspection is assigned",
        trigger_type: "task_status_changed",
        trigger_conditions: {"field":"assigned_to_email","operator":"is_not_empty","value":null},
        company_id: companyId,
        is_active: true,
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"{assigned_to_email}","email_subject":"🔧 New Work Assignment: {property_address}","email_body":"See Email Templates for full template"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":0,"recipient":"{assigned_to_email}","sms_message":"See SMS Templates for template"},
          {"step":3,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"{client_email}","email_subject":"Your upcoming property inspection with {company_name}","email_body":"See Email Templates for client confirmation"}
        ]
      },
      {
        workflow_name: "Inspection Reminder - 24 Hours Before",
        description: "Automatically reminds customers 24 hours before their scheduled inspection",
        trigger_type: "appointment_created",
        company_id: companyId,
        is_active: true,
        folder: "Marketing Automations",
        actions: [
          {"step":1,"action_type":"send_sms","schedule_type":"delay","delay_minutes":1440,"recipient":"{customer_phone}","sms_message":"⏰ Reminder: Your roof inspection is tomorrow at {property_address}. Your inspector {inspector_name} will arrive as scheduled. Questions? Call us! - {company_name}"},
          {"step":2,"action_type":"send_email","schedule_type":"delay","delay_minutes":1440,"recipient":"{customer_email}","email_subject":"🏠 Inspection Tomorrow - Everything You Need to Know","email_body":"Hi {customer_name},\\n\\nThis is a friendly reminder that your roof inspection is scheduled for tomorrow.\\n\\n📍 Address: {property_address}\\n👤 Inspector: {inspector_name}\\n📞 Inspector Phone: {inspector_phone}\\n\\nWhat to expect:\\n✓ External roof inspection (no need to be home)\\n✓ Duration: 30-45 minutes\\n✓ Full report within 24 hours\\n\\nNeed to reschedule? Call us at 216-999-6222\\n\\nBest regards,\\n{company_name}"}
        ]
      },
      {
        workflow_name: "Appointment Confirmation - Instant",
        description: "Sends instant confirmation when inspection is booked",
        trigger_type: "appointment_created",
        company_id: companyId,
        is_active: true,
        folder: "Marketing Automations",
        actions: [
          {"step":1,"action_type":"send_sms","schedule_type":"delay","delay_minutes":0,"recipient":"{customer_phone}","sms_message":"✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}"},
          {"step":2,"action_type":"send_email","schedule_type":"delay","delay_minutes":5,"recipient":"{customer_email}","email_subject":"✅ Your Inspection is Confirmed!","email_body":"Hi {customer_name},\\n\\nGreat news! Your roof inspection has been confirmed.\\n\\n📅 Date & Time: {scheduled_date}\\n📍 Property: {property_address}\\n👤 Inspector: {inspector_name}\\n📞 Inspector Contact: {inspector_phone}\\n\\nWhat happens next:\\n1. Your inspector will contact you 24 hours before\\n2. External inspection will take 30-45 minutes\\n3. You'll receive a full report within 24 hours\\n4. We'll handle communication with your insurance\\n\\nQuestions? Call us anytime at 216-999-6222\\n\\nThank you for choosing {company_name}!\\n\\nBest regards,\\nVicky - Operations Manager"}
        ]
      },
      {
        workflow_name: "Post-Inspection Follow-Up - 2 Hours After",
        description: "Follows up after inspection completion to send next steps",
        trigger_type: "manual",
        company_id: companyId,
        is_active: true,
        folder: "Marketing Automations",
        actions: [
          {"step":1,"action_type":"send_sms","schedule_type":"delay","delay_minutes":120,"recipient":"{customer_phone}","sms_message":"Hi {customer_name}, This is {company_name}. The team successfully finished the inspection. We are coordinating with your insurance company. We will contact you as soon as we have additional information. You should receive an email on the Contingency Agreement to sign. Thanks!"},
          {"step":2,"action_type":"send_email","schedule_type":"delay","delay_minutes":125,"recipient":"{customer_email}","email_subject":"✅ Inspection Complete - Next Steps","email_body":"Hi {customer_name},\\n\\nThank you for allowing us to inspect your property today. Here's what happens next:\\n\\n✅ COMPLETED:\\n• Thorough roof inspection\\n• Damage documentation with photos\\n• Initial assessment\\n\\n🔄 IN PROGRESS:\\n• Preparing detailed report for insurance\\n• Coordinating with your insurance provider\\n• Reviewing coverage and claim options\\n\\n📋 NEXT STEPS:\\n1. Review and sign the Contingency Agreement (check your email)\\n2. We'll submit our findings to your insurance\\n3. You'll receive a full report within 24-48 hours\\n4. We'll schedule a follow-up call to discuss the results\\n\\nIMPORTANT: Please check your email for the Contingency Agreement and sign it as soon as possible to keep the claim process moving.\\n\\nQuestions? Call Vicky at 216-238-6431 or email yicnteam@gmail.com\\n\\nThank you for trusting {company_name}!\\n\\nBest regards,\\nVicky - Operations Manager"}
        ]
      },
      {
        workflow_name: "30-Day Referral Request Campaign",
        description: "Requests referrals 30 days after successful project completion",
        trigger_type: "project_completed",
        company_id: companyId,
        is_active: true,
        folder: "Marketing Automations",
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":43200,"recipient":"{customer_email}","email_subject":"🎉 Thank You! Earn $250 for Every Referral","email_body":"Dear {customer_name},\\n\\nThank you for choosing {company_name} for your recent roofing project. We hope you love your new roof!\\n\\n💰 REFER A NEIGHBOR & EARN $250\\n\\nDo you know someone who needs roofing work?\\n\\nHere's how it works:\\n1. Give us their name and contact info\\n2. We provide them a free estimate\\n3. If they hire us, you get $250 cash!\\n\\n🎯 No limit on referrals. Refer 4 neighbors = $1,000 bonus!\\n\\nWHY REFER?\\n• Help your friends get quality roofing\\n• Earn rewards for each successful referral\\n• Support local business in your community\\n\\nThank you for spreading the word about {company_name}!\\n\\nBest regards,\\n{company_name}\\n\\nP.S. Your friends will thank you for the recommendation!"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":43205,"recipient":"{customer_phone}","sms_message":"Hi {customer_name}! 🎉 Love your new roof? Refer a friend and earn $250! No limit on referrals. Thanks! - {company_name}"}
        ]
      },
      {
        workflow_name: "7-Day Post-Service Check-In",
        description: "Checks in with customers 7 days after project completion",
        trigger_type: "project_completed",
        company_id: companyId,
        is_active: true,
        folder: "Marketing Automations",
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":10080,"recipient":"{customer_email}","email_subject":"How's Your New Roof? We'd Love Your Feedback!","email_body":"Hi {customer_name},\\n\\nIt's been a week since we completed your roofing project, and we wanted to check in!\\n\\n❓ Quick Questions:\\n• How is everything with your new roof?\\n• Are you satisfied with the work quality?\\n• Do you have any concerns or questions?\\n\\nWe take pride in our work and your satisfaction is our #1 priority. If anything isn't perfect, please let us know immediately so we can make it right.\\n\\n⭐ LOVE YOUR NEW ROOF?\\nWe'd be grateful if you could:\\n1. Leave us a Google review: [Google Review Link]\\n2. Refer friends/family (earn $250 per referral!)\\n\\n📞 Need Anything?\\nCall us anytime at 216-999-6222 or reply to this email.\\n\\nThank you for choosing {company_name}!\\n\\nBest regards,\\nKevin Stone\\nCustomer Success Manager"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":10085,"recipient":"{customer_phone}","sms_message":"Hi {customer_name}! 👋 It's been a week since we completed your roof. Everything looking good? Any concerns? We're here to help! Also, earn $250 for every friend you refer! 😊 - {company_name}"}
        ]
      },
      {
        workflow_name: "30-Day Lead Nurture Campaign",
        description: "Automated multi-week follow-up sequence for new leads with emails and SMS",
        trigger_type: "lead_created",
        company_id: companyId,
        is_active: true,
        folder: "Marketing Automations",
        actions: [
          {"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"lead","email_subject":"Welcome! Let's Get Started with Your Roofing Project","email_body":"Hi {contact_name},\\n\\nThank you for reaching out! We're excited to help you with your roofing needs.\\n\\nAt {company_name}, we specialize in high-quality roofing solutions with over 20 years of experience. Whether you need repairs, replacement, or a new installation, we've got you covered.\\n\\n🏠 What happens next?\\n• One of our experts will contact you within 24 hours\\n• We'll schedule a FREE inspection at your convenience\\n• You'll receive a detailed estimate with no obligation\\n\\nIn the meantime, feel free to reply to this email or call us at any time.\\n\\nBest regards,\\n{company_name} Team"},
          {"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":60,"recipient":"lead","sms_message":"Hi {contact_name}! This is {company_name}. Thanks for your interest! We'll be in touch within 24 hours to schedule your FREE roof inspection. Questions? Just reply!"},
          {"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":1440,"recipient":"yicnteam@gmail.com","task_title":"Follow up with {contact_name} - New Lead","task_description":"Call {contact_name} at {contact_phone} to schedule their FREE roof inspection.\\n\\nLead source: {source}\\nProperty: {address}"},
          {"step":4,"action_type":"send_email","schedule_type":"delay","delay_minutes":4320,"recipient":"lead","email_subject":"Why Homeowners Trust {company_name} for Their Roofing Needs","email_body":"Hi {contact_name},\\n\\nWe wanted to share what makes {company_name} different:\\n\\n✅ 20+ Years of Excellence\\n✅ Licensed & Fully Insured\\n✅ A+ BBB Rating\\n✅ Lifetime Workmanship Warranty\\n✅ Free Inspections & Estimates\\n\\n💬 Here's what our customers say:\\n\\\"Best roofing company we've ever worked with! Professional, fast, and affordable.\\\" - Sarah M.\\n\\n\\\"They went above and beyond. My new roof looks amazing!\\\" - Mike T.\\n\\nReady to get started? Just reply to this email or give us a call.\\n\\nBest,\\n{company_name}"},
          {"step":5,"action_type":"send_sms","schedule_type":"delay","delay_minutes":10080,"recipient":"lead","sms_message":"Hi {contact_name}, just checking in! Have you had a chance to think about your roofing project? We'd love to provide a FREE estimate. Reply YES to schedule!"},
          {"step":6,"action_type":"send_email","schedule_type":"delay","delay_minutes":14400,"recipient":"lead","email_subject":"🎁 Special Offer: Save $500 on Your Roofing Project","email_body":"Hi {contact_name},\\n\\nWe have some exciting news! For a limited time, we're offering:\\n\\n💰 $500 OFF any complete roof replacement\\n🆓 FREE roof inspection & estimate\\n📅 Priority scheduling available\\n\\nThis offer is only available for the next 14 days, so don't miss out!\\n\\nWhy wait?\\n• Winter weather is coming - protect your home now\\n• Lock in today's pricing before rates increase\\n• Get peace of mind with our warranty\\n\\n👉 Schedule your FREE inspection today!\\n\\nClick here to book: [Schedule Now]\\n\\nBest regards,\\n{company_name} Team"},
          {"step":7,"action_type":"send_email","schedule_type":"delay","delay_minutes":20160,"recipient":"lead","email_subject":"Don't Let Roof Damage Cost You Thousands Later","email_body":"Hi {contact_name},\\n\\nDid you know that small roof issues can quickly turn into expensive repairs?\\n\\n⚠️ Warning signs to watch for:\\n• Missing or damaged shingles\\n• Leaks or water stains\\n• Sagging roof areas\\n• High energy bills\\n• Visible wear and tear\\n\\nThe good news? We can help you catch problems early with our FREE roof inspection.\\n\\n📞 What our inspection includes:\\n✓ Complete roof assessment\\n✓ Photo documentation\\n✓ Detailed written report\\n✓ Free estimate for any needed repairs\\n✓ No obligation - 100% FREE\\n\\nProtect your biggest investment. Schedule your inspection today!\\n\\nBest,\\n{company_name}"},
          {"step":8,"action_type":"send_sms","schedule_type":"delay","delay_minutes":30240,"recipient":"lead","sms_message":"Hi {contact_name}! Don't miss out - your $500 discount expires in 7 days! Reply NOW to schedule your FREE roof inspection. - {company_name}"},
          {"step":9,"action_type":"send_email","schedule_type":"delay","delay_minutes":36000,"recipient":"lead","email_subject":"⏰ Last Chance: Your $500 Discount Expires in 3 Days!","email_body":"Hi {contact_name},\\n\\nThis is your final reminder!\\n\\nYour exclusive $500 discount on roof replacement expires in just 3 DAYS.\\n\\n⏰ Act now to:\\n✅ Save $500 on your project\\n✅ Get FREE inspection & estimate\\n✅ Lock in current pricing\\n✅ Protect your home before winter\\n\\nDon't let this opportunity slip away!\\n\\n📞 Call us now: [Phone]\\n📧 Reply to this email\\n🌐 Book online: [Website]\\n\\nWe're here to help!\\n\\n{company_name} Team\\n\\nP.S. This is a limited-time offer. Once it's gone, it's gone!"},
          {"step":10,"action_type":"create_task","schedule_type":"delay","delay_minutes":43200,"recipient":"yicnteam@gmail.com","task_title":"FINAL FOLLOW-UP: {contact_name} - 30 Day Nurture Complete","task_description":"This lead has completed the 30-day nurture campaign without converting.\\n\\nLead: {contact_name}\\nPhone: {contact_phone}\\nEmail: {contact_email}\\n\\nAction items:\\n1. Make one final personal call\\n2. If no response, move to long-term nurture list\\n3. Update lead status accordingly"}
        ]
      }
    ];

    let created = 0;
    let skipped = 0;

    for (const workflow of workflows) {
      // Check if already exists
      const existing = await base44.asServiceRole.entities.Workflow.filter({
        company_id: companyId,
        workflow_name: workflow.workflow_name
      });

      if (existing.length === 0) {
        await base44.asServiceRole.entities.Workflow.create(workflow);
        console.log('✅ Created workflow:', workflow.workflow_name);
        created++;
      } else {
        console.log('⏭️ Skipped existing workflow:', workflow.workflow_name);
        skipped++;
      }
    }

    return Response.json({
      success: true,
      created,
      skipped,
      total: workflows.length,
      message: `Setup complete! Created ${created} workflows, skipped ${skipped} existing.`
    });

  } catch (error) {
    console.error('💥 ERROR:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});