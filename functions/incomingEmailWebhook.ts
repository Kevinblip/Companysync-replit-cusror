import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const contentType = req.headers.get('content-type') || '';
        const formData = contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')
          ? await req.formData()
          : null;

        const from = formData ? (formData.get('from') || '') : (req.headers.get('x-email-from') || '');
        const subject = formData ? (formData.get('subject') || '') : (req.headers.get('x-email-subject') || '');
        const text = formData ? (formData.get('text') || '') : await req.text();
        const to = formData ? (formData.get('to') || '') : (req.headers.get('x-email-to') || '');

        console.log('📧 Incoming email from:', from, 'subject:', subject);

        const base44 = createClientFromRequest(req);

        // Parse from email address
        const fromEmailMatch = from.match(/<(.+)>/);
        const fromEmail = fromEmailMatch ? fromEmailMatch[1] : from;
        const fromNameMatch = from.match(/^(.+?)\s*</);
        const fromName = fromNameMatch ? fromNameMatch[1].replace(/['"]/g, '') : fromEmail;

        // Find company by recipient email
        const companies = await base44.asServiceRole.entities.Company.list();
        let targetCompany = null;

        for (const company of companies) {
            if (to.includes(company.email) || to.includes(company.company_name?.toLowerCase().replace(/\s+/g, ''))) {
                targetCompany = company;
                break;
            }
        }

        if (!targetCompany && companies.length > 0) {
            targetCompany = companies[0]; // Default to first company
        }

        if (!targetCompany) {
            console.error('❌ No company found for email:', to);
            return new Response('OK', { status: 200 });
        }

        console.log('✅ Processing for company:', targetCompany.company_name);

        // 1) Try to extract a phone number from the transcript for matching
        const phoneMatch = (text || '').match(/\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/);
        const phone = phoneMatch ? phoneMatch[0] : null;

        // 2) Attempt to find an existing Lead or Customer by phone or email
        let person = null;
        if (phone) {
            const leadsByPhone = await base44.asServiceRole.entities.Lead.filter({ phone: phone });
            const customersByPhone = await base44.asServiceRole.entities.Customer.filter({ phone: phone });
            person = leadsByPhone[0] || customersByPhone[0] || null;
        }
        if (!person && fromEmail) {
            const leadsByEmail = await base44.asServiceRole.entities.Lead.filter({ email: fromEmail });
            const customersByEmail = await base44.asServiceRole.entities.Customer.filter({ email: fromEmail });
            person = leadsByEmail[0] || customersByEmail[0] || null;
        }

        // 3) If not found, create a Lead
        if (!person) {
            person = await base44.asServiceRole.entities.Lead.create({
                name: fromName || 'Unknown Caller',
                email: fromEmail || undefined,
                phone: phone || undefined,
                source: 'ai',
                lead_source: 'Thoughtly Email',
                status: 'contacted',
                company_id: targetCompany.id,
                notes: `Created from transcript email: ${subject}`
            });
        }

        const personType = person?.customer_type ? 'customer' : 'lead';
        const displayName = person?.name || person?.customer_name || fromName || 'Unknown';

        // 4) Persist the conversation into ConversationHistory
        const convo = await base44.asServiceRole.entities.ConversationHistory.create({
            company_id: targetCompany.id,
            contact_name: displayName,
            contact_email: fromEmail || undefined,
            contact_phone: phone || undefined,
            communication_type: 'call',
            direction: 'inbound',
            subject: subject || 'Thoughtly Call Summary',
            message: text || '',
            source: 'thoughtly_email',
            related_to: personType === 'lead' ? person.name : person.customer_name || displayName,
            tags: ['thoughtly', 'transcript']
        });

        // 5) Notify staff
        try {
            await base44.asServiceRole.functions.invoke('createNotification', {
                user_email: person?.assigned_to || null,
                title: 'New Thoughtly Call Transcript',
                message: `${displayName}: ${subject}`,
                link_url: `/pages/Leads?id=${person?.id}`
            });
        } catch (_) {}

        return Response.json({ ok: true, linked_to: personType, person_id: person?.id, conversation_id: convo?.id });

    } catch (error) {
        console.error('❌ Email webhook error:', error);
        return new Response('Error', { status: 500 });
    }
});