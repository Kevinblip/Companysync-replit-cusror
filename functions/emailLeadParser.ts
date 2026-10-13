import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This endpoint can be used with email forwarding services
    // Forward your Facebook lead emails to this webhook
    const body = await req.json();
    console.log('📧 Email Lead Parser');
    
    // Parse email content (format depends on email service)
    let emailText = body.text || body.html || body.plain || '';
    let emailSubject = body.subject || '';
    
    console.log('Subject:', emailSubject);
    console.log('Body:', emailText.substring(0, 200));
    
    // Extract lead info using regex patterns
    const nameMatch = emailText.match(/Name:\s*(.+?)(?:\n|Email)/i);
    const emailMatch = emailText.match(/Email:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    const phoneMatch = emailText.match(/Phone:\s*(.+?)(?:\n|Property)/i);
    const addressMatch = emailText.match(/Property Address:\s*(.+?)(?:\n|,)/i);
    
    const leadName = nameMatch ? nameMatch[1].trim() : 'Email Lead';
    const leadEmail = emailMatch ? emailMatch[1].trim() : '';
    const leadPhone = phoneMatch ? phoneMatch[1].trim() : '';
    const leadAddress = addressMatch ? addressMatch[1].trim() : '';
    
    if (!leadName && !leadEmail && !leadPhone) {
      console.log('⚠️ Could not extract lead data from email');
      return Response.json({ 
        success: false, 
        error: 'No lead data found in email' 
      }, { status: 400 });
    }
    
    console.log(`📋 Extracted: ${leadName} | ${leadEmail} | ${leadPhone}`);
    
    // Get company
    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
    const company = companies[0];
    
    // Create lead
    const newLead = await base44.asServiceRole.entities.Lead.create({
      company_id: company?.id,
      name: leadName,
      email: leadEmail,
      phone: leadPhone,
      street: leadAddress,
      source: 'social_media',
      lead_source: 'Facebook Lead Ads (Email)',
      status: 'new',
      is_active: true,
      notes: `Lead captured from forwarded email.\n\nSubject: ${emailSubject}\n\nOriginal message:\n${emailText.substring(0, 500)}`
    });
    
    console.log(`✅ Lead created: ${newLead.id}`);
    
    // Notify admins
    if (company?.id) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
        company_id: company.id,
        is_administrator: true
      });
      
      for (const staff of staffProfiles) {
        await base44.asServiceRole.entities.Notification.create({
          company_id: company.id,
          user_email: staff.user_email,
          title: '🎯 New Facebook Lead!',
          message: `${leadName} - ${leadPhone || leadEmail}`,
          type: 'lead_created',
          related_entity_type: 'Lead',
          related_entity_id: newLead.id,
          link_url: '/leads',
          is_read: false
        });
      }
    }
    
    return Response.json({ 
      success: true, 
      lead_id: newLead.id,
      lead_name: leadName
    });
    
  } catch (error) {
    console.error('❌ Email parser error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});