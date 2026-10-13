import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting company_id backfill for user:', user.email);

        // Get user's company
        const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        let myCompany = companies[0];

        if (!myCompany) {
            // Check if user is staff
            const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
            if (staffProfiles[0]) {
                const allCompanies = await base44.asServiceRole.entities.Company.filter({ id: staffProfiles[0].company_id });
                myCompany = allCompanies[0];
            }
        }

        if (!myCompany) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        const companyId = myCompany.id;
        console.log('✅ Company:', myCompany.company_name, 'ID:', companyId);

        const stats = {
            leads: 0,
            customers: 0,
            invoices: 0,
            estimates: 0,
            projects: 0,
            tasks: 0,
            payments: 0,
            communications: 0,
            calendarEvents: 0,
            documents: 0
        };

        // Backfill Leads
        console.log('📋 Backfilling Leads...');
        const allLeads = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
        for (const lead of allLeads) {
            if (!lead.company_id) {
                await base44.asServiceRole.entities.Lead.update(lead.id, { company_id: companyId });
                stats.leads++;
            }
        }

        // Backfill Customers
        console.log('👥 Backfilling Customers...');
        const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
        for (const customer of allCustomers) {
            if (!customer.company_id) {
                await base44.asServiceRole.entities.Customer.update(customer.id, { company_id: companyId });
                stats.customers++;
            }
        }

        // Backfill Invoices
        console.log('🧾 Backfilling Invoices...');
        const allInvoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
        for (const invoice of allInvoices) {
            if (!invoice.company_id) {
                await base44.asServiceRole.entities.Invoice.update(invoice.id, { company_id: companyId });
                stats.invoices++;
            }
        }

        // Backfill Estimates
        console.log('📄 Backfilling Estimates...');
        const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
        for (const estimate of allEstimates) {
            if (!estimate.company_id) {
                await base44.asServiceRole.entities.Estimate.update(estimate.id, { company_id: companyId });
                stats.estimates++;
            }
        }

        // Backfill Projects
        console.log('💼 Backfilling Projects...');
        const allProjects = await base44.asServiceRole.entities.Project.list('-created_date', 10000);
        for (const project of allProjects) {
            if (!project.company_id) {
                await base44.asServiceRole.entities.Project.update(project.id, { company_id: companyId });
                stats.projects++;
            }
        }

        // Backfill Tasks
        console.log('✅ Backfilling Tasks...');
        const allTasks = await base44.asServiceRole.entities.Task.list('-created_date', 10000);
        for (const task of allTasks) {
            if (!task.company_id) {
                await base44.asServiceRole.entities.Task.update(task.id, { company_id: companyId });
                stats.tasks++;
            }
        }

        // Backfill Payments
        console.log('💰 Backfilling Payments...');
        const allPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
        for (const payment of allPayments) {
            if (!payment.company_id) {
                await base44.asServiceRole.entities.Payment.update(payment.id, { company_id: companyId });
                stats.payments++;
            }
        }

        // Backfill Communications
        console.log('📞 Backfilling Communications...');
        const allCommunications = await base44.asServiceRole.entities.Communication.list('-created_date', 10000);
        for (const comm of allCommunications) {
            if (!comm.company_id) {
                await base44.asServiceRole.entities.Communication.update(comm.id, { company_id: companyId });
                stats.communications++;
            }
        }

        // Backfill Calendar Events
        console.log('📅 Backfilling Calendar Events...');
        const allEvents = await base44.asServiceRole.entities.CalendarEvent.list('-created_date', 10000);
        for (const event of allEvents) {
            if (!event.company_id) {
                await base44.asServiceRole.entities.CalendarEvent.update(event.id, { company_id: companyId });
                stats.calendarEvents++;
            }
        }

        // Backfill Documents
        console.log('📁 Backfilling Documents...');
        const allDocuments = await base44.asServiceRole.entities.Document.list('-created_date', 10000);
        for (const doc of allDocuments) {
            if (!doc.company_id) {
                await base44.asServiceRole.entities.Document.update(doc.id, { company_id: companyId });
                stats.documents++;
            }
        }

        console.log('✅ Backfill complete!', stats);

        return Response.json({
            success: true,
            company_name: myCompany.company_name,
            company_id: companyId,
            stats: stats,
            total_updated: Object.values(stats).reduce((sum, val) => sum + val, 0)
        });

    } catch (error) {
        console.error('❌ Backfill error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});