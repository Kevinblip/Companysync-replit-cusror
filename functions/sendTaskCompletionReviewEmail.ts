import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Parse the automation payload
        const payload = await req.json();
        const { event, data, old_data } = payload;

        // Validation: Only proceed if status changed to 'job_completed'
        if (!data || !old_data) {
            return Response.json({ message: 'Missing data or old_data' });
        }
        
        if (data.status !== 'job_completed' || old_data.status === 'job_completed') {
            return Response.json({ message: 'Status did not change to job_completed' });
        }

        // We only send emails for tasks related to customers
        if (data.source !== 'customer' || !data.related_to) {
            return Response.json({ message: 'Task is not related to a customer' });
        }

        // 1. Find the customer
        // We match by name and company_id since Task doesn't have customer_id
        const customers = await base44.asServiceRole.entities.Customer.filter({
            company_id: data.company_id,
            name: data.related_to
        });

        if (!customers || customers.length === 0) {
            console.log(`Customer not found for task ${data.id} (related_to: ${data.related_to})`);
            return Response.json({ message: 'Customer not found' });
        }

        const customer = customers[0];
        if (!customer.email) {
            console.log(`Customer ${customer.name} has no email`);
            return Response.json({ message: 'Customer has no email' });
        }

        // 2. Fetch Company details
        const companies = await base44.asServiceRole.entities.Company.filter({
            id: data.company_id
        });
        
        if (!companies || companies.length === 0) {
            return Response.json({ message: 'Company not found' });
        }
        const company = companies[0];

        // 3. Fetch Company Settings for review link
        const companySettings = await base44.asServiceRole.entities.CompanySetting.filter({
            company_id: data.company_id
        });
        const settings = companySettings[0] || {};
        
        // Use company's review link if set, otherwise fallback to the one provided in request
        const reviewLink = settings.google_review_link || "https://tiny.one/letsreview";
        
        // 4. Construct Email
        // Dynamic signature based on who completed it? 
        // For now using Company Name as the signature line 2, and maybe "Customer Support" or similar as line 1 if we don't know who.
        // Format: "{User Name} \n {Company Name}"
        // We'll use: "{User Name} \n {Company Name}"
        // We can try to get the user who updated the task? 
        // The automation payload might not have 'updated_by'. 
        // We'll use a generic signature or the Company Name.
        // Let's use the company contact name or just Company Name.
        
        // Actually, let's try to get the assigned user's name if available
        let senderName = company.company_name;
        if (data.assigned_to_name) {
            senderName = data.assigned_to_name;
        } else if (data.assignees && data.assignees.length > 0) {
            senderName = data.assignees[0].name;
        } else {
             // Fallback to generic
             senderName = "Customer Success Team";
        }

        const subject = `Google Review Request | ${company.company_name}`;
        
        const body = `Dear ${customer.name},

Thank you again for choosing ${company.company_name} for your recent project. We truly appreciate the opportunity to work with you and hope that everything was completed to your satisfaction.

If you have a moment, we would be grateful if you could leave us a review on Google. Your feedback not only helps us grow but also helps others who may be looking for trusted roofing and restoration services.

You can leave your review by clicking this link:
👉 ${reviewLink}

Thank you in advance for your time and support!


Kind regards,

--
${senderName}
${company.company_name}
${company.phone || settings.phone_number || ''}`;

        // 5. Send Email
        await base44.asServiceRole.integrations.Core.SendEmail({
            to: customer.email,
            subject: subject,
            body: body,
            from_name: company.company_name
        });

        return Response.json({ success: true, message: `Email sent to ${customer.email}` });

    } catch (error) {
        console.error('Error sending task review email:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});