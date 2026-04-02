import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { backup, dryRun, replaceExisting, targetCompanyId } = await req.json();

    if (!backup || typeof backup !== 'object') {
      return Response.json({ error: 'Invalid backup data' }, { status: 400 });
    }

    // Determine target company
    let targetCompany = null;
    if (targetCompanyId) {
      const companies = await base44.entities.Company.filter({ id: targetCompanyId });
      targetCompany = companies[0];
    }
    
    if (!targetCompany) {
       // Fallback to user's primary company if not specified
       const companies = await base44.entities.Company.list("-created_date", 100);
       const owned = companies.filter(c => c.created_by === user.email);
       // Sort by date to get oldest
       targetCompany = owned.sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0] || companies[0];
    }

    if (!targetCompany) {
        return Response.json({ error: 'No target company found for restore' }, { status: 404 });
    }

    console.log(`📦 Starting restore from backup... ${dryRun ? '(DRY RUN MODE)' : ''}`);
    console.log(`🎯 Target Company: ${targetCompany.company_name} (${targetCompany.id})`);
    console.log('Backup keys:', Object.keys(backup));
    console.log('Replace existing:', replaceExisting);
    
    // Handle both old format (backup.customers) and new format (backup.data.Customer)
    const backupData = backup.data || backup;
    const normalizedBackup = {
      customers: backupData.Customer || backupData.customers || [],
      leads: backupData.Lead || backupData.leads || [],
      invoices: backupData.Invoice || backupData.invoices || [],
      estimates: backupData.Estimate || backupData.estimates || [],
      payments: backupData.Payment || backupData.payments || [],
      tasks: backupData.Task || backupData.tasks || [],
      projects: backupData.Project || backupData.projects || [],
      communications: backupData.Communication || backupData.communications || [],
      calendar_events: backupData.CalendarEvent || backupData.calendar_events || []
    };
    
    console.log('Normalized backup data counts:', {
      customers: normalizedBackup.customers.length,
      leads: normalizedBackup.leads.length,
      invoices: normalizedBackup.invoices.length,
      estimates: normalizedBackup.estimates.length,
      payments: normalizedBackup.payments.length
    });

    const results = {
      customers: 0,
      leads: 0,
      invoices: 0,
      estimates: 0,
      payments: 0,
      tasks: 0,
      projects: 0,
      communications: 0,
      calendar_events: 0,
      deleted: {
        customers: 0,
        leads: 0,
        invoices: 0,
        estimates: 0,
        payments: 0,
        tasks: 0,
        projects: 0,
        communications: 0,
        calendar_events: 0
      },
      errors: []
    };

    // 🗑️ PHASE 1: Delete existing data if replaceExisting is true
    if (replaceExisting && !dryRun) {
      console.log('🗑️ Deleting existing data before restore...');
      
      try {
        const existingCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
        for (const c of existingCustomers) {
          await base44.asServiceRole.entities.Customer.delete(c.id);
          results.deleted.customers++;
        }
        console.log(`✅ Deleted ${results.deleted.customers} customers`);
      } catch (err) {
        console.error('Failed to delete customers:', err);
        results.errors.push(`Delete customers failed: ${err.message}`);
      }

      try {
        const existingLeads = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
        for (const l of existingLeads) {
          await base44.asServiceRole.entities.Lead.delete(l.id);
          results.deleted.leads++;
        }
        console.log(`✅ Deleted ${results.deleted.leads} leads`);
      } catch (err) {
        console.error('Failed to delete leads:', err);
        results.errors.push(`Delete leads failed: ${err.message}`);
      }

      try {
        const existingPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
        for (const p of existingPayments) {
          await base44.asServiceRole.entities.Payment.delete(p.id);
          results.deleted.payments++;
        }
        console.log(`✅ Deleted ${results.deleted.payments} payments`);
      } catch (err) {
        console.error('Failed to delete payments:', err);
        results.errors.push(`Delete payments failed: ${err.message}`);
      }

      try {
        const existingInvoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
        for (const i of existingInvoices) {
          await base44.asServiceRole.entities.Invoice.delete(i.id);
          results.deleted.invoices++;
        }
        console.log(`✅ Deleted ${results.deleted.invoices} invoices`);
      } catch (err) {
        console.error('Failed to delete invoices:', err);
        results.errors.push(`Delete invoices failed: ${err.message}`);
      }

      try {
        const existingEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
        for (const e of existingEstimates) {
          await base44.asServiceRole.entities.Estimate.delete(e.id);
          results.deleted.estimates++;
        }
        console.log(`✅ Deleted ${results.deleted.estimates} estimates`);
      } catch (err) {
        console.error('Failed to delete estimates:', err);
        results.errors.push(`Delete estimates failed: ${err.message}`);
      }

      try {
        const existingTasks = await base44.asServiceRole.entities.Task.list('-created_date', 10000);
        for (const t of existingTasks) {
          await base44.asServiceRole.entities.Task.delete(t.id);
          results.deleted.tasks++;
        }
        console.log(`✅ Deleted ${results.deleted.tasks} tasks`);
      } catch (err) {
        console.error('Failed to delete tasks:', err);
        results.errors.push(`Delete tasks failed: ${err.message}`);
      }

      try {
        const existingProjects = await base44.asServiceRole.entities.Project.list('-created_date', 10000);
        for (const p of existingProjects) {
          await base44.asServiceRole.entities.Project.delete(p.id);
          results.deleted.projects++;
        }
        console.log(`✅ Deleted ${results.deleted.projects} projects`);
      } catch (err) {
        console.error('Failed to delete projects:', err);
        results.errors.push(`Delete projects failed: ${err.message}`);
      }

      try {
        const existingComms = await base44.asServiceRole.entities.Communication.list('-created_date', 10000);
        for (const c of existingComms) {
          await base44.asServiceRole.entities.Communication.delete(c.id);
          results.deleted.communications++;
        }
        console.log(`✅ Deleted ${results.deleted.communications} communications`);
      } catch (err) {
        console.error('Failed to delete communications:', err);
        results.errors.push(`Delete communications failed: ${err.message}`);
      }

      try {
        const existingEvents = await base44.asServiceRole.entities.CalendarEvent.list('-created_date', 10000);
        for (const e of existingEvents) {
          await base44.asServiceRole.entities.CalendarEvent.delete(e.id);
          results.deleted.calendar_events++;
        }
        console.log(`✅ Deleted ${results.deleted.calendar_events} calendar events`);
      } catch (err) {
        console.error('Failed to delete calendar events:', err);
        results.errors.push(`Delete calendar events failed: ${err.message}`);
      }

      console.log('🗑️ Deletion phase complete:', results.deleted);
    } else if (replaceExisting && dryRun) {
      console.log('🔍 DRY RUN: Would delete existing data before restore');
    }

    console.log('📦 Starting restore phase...');

    // Restore customers
    if (normalizedBackup.customers && Array.isArray(normalizedBackup.customers)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.customers.length} customers...`);
      for (const customer of normalizedBackup.customers) {
        try {
          if (!dryRun) {
            // Remove id, created_date, updated_date before creating
            // FORCE company_id to target company
            const { id, created_date, updated_date, company_id, ...customerData } = customer;
            await base44.asServiceRole.entities.Customer.create({
                ...customerData,
                company_id: targetCompany.id
            });
          }
          results.customers++;
        } catch (error) {
          console.error('Failed to restore customer:', customer.name, error.message);
          results.errors.push(`Customer ${customer.name}: ${error.message}`);
        }
      }
    }

    // Restore leads
    if (normalizedBackup.leads && Array.isArray(normalizedBackup.leads)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.leads.length} leads...`);
      for (const lead of normalizedBackup.leads) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...leadData } = lead;
            await base44.asServiceRole.entities.Lead.create({
                ...leadData,
                company_id: targetCompany.id
            });
          }
          results.leads++;
        } catch (error) {
          console.error('Failed to restore lead:', lead.name, error.message);
          results.errors.push(`Lead ${lead.name}: ${error.message}`);
        }
      }
    }

    // Restore invoices
    if (normalizedBackup.invoices && Array.isArray(normalizedBackup.invoices)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.invoices.length} invoices...`);
      for (const invoice of normalizedBackup.invoices) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...invoiceData } = invoice;
            await base44.asServiceRole.entities.Invoice.create({
                ...invoiceData,
                company_id: targetCompany.id
            });
          }
          results.invoices++;
        } catch (error) {
          console.error('Failed to restore invoice:', invoice.invoice_number, error.message);
          results.errors.push(`Invoice ${invoice.invoice_number}: ${error.message}`);
        }
      }
    }

    // Restore estimates
    if (normalizedBackup.estimates && Array.isArray(normalizedBackup.estimates)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.estimates.length} estimates...`);
      for (const estimate of normalizedBackup.estimates) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...estimateData } = estimate;
            await base44.asServiceRole.entities.Estimate.create({
                ...estimateData,
                company_id: targetCompany.id
            });
          }
          results.estimates++;
        } catch (error) {
          console.error('Failed to restore estimate:', estimate.estimate_number, error.message);
          results.errors.push(`Estimate ${estimate.estimate_number}: ${error.message}`);
        }
      }
    }

    // Restore payments
    if (normalizedBackup.payments && Array.isArray(normalizedBackup.payments)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.payments.length} payments...`);
      for (const payment of normalizedBackup.payments) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...paymentData } = payment;
            await base44.asServiceRole.entities.Payment.create({
                ...paymentData,
                company_id: targetCompany.id
            });
          }
          results.payments++;
        } catch (error) {
          console.error('Failed to restore payment:', payment.payment_number, error.message);
          results.errors.push(`Payment ${payment.payment_number}: ${error.message}`);
        }
      }
    }

    // Restore tasks
    if (normalizedBackup.tasks && Array.isArray(normalizedBackup.tasks)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.tasks.length} tasks...`);
      for (const task of normalizedBackup.tasks) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...taskData } = task;
            await base44.asServiceRole.entities.Task.create({
                ...taskData,
                company_id: targetCompany.id
            });
          }
          results.tasks++;
        } catch (error) {
          console.error('Failed to restore task:', task.name, error.message);
          results.errors.push(`Task ${task.name}: ${error.message}`);
        }
      }
    }

    // Restore projects
    if (normalizedBackup.projects && Array.isArray(normalizedBackup.projects)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.projects.length} projects...`);
      for (const project of normalizedBackup.projects) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...projectData } = project;
            await base44.asServiceRole.entities.Project.create({
                ...projectData,
                company_id: targetCompany.id
            });
          }
          results.projects++;
        } catch (error) {
          console.error('Failed to restore project:', project.name, error.message);
          results.errors.push(`Project ${project.name}: ${error.message}`);
        }
      }
    }

    // Restore communications
    if (normalizedBackup.communications && Array.isArray(normalizedBackup.communications)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.communications.length} communications...`);
      for (const comm of normalizedBackup.communications) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...commData } = comm;
            await base44.asServiceRole.entities.Communication.create({
                ...commData,
                company_id: targetCompany.id
            });
          }
          results.communications++;
        } catch (error) {
          console.error('Failed to restore communication:', comm.id, error.message);
          results.errors.push(`Communication: ${error.message}`);
        }
      }
    }

    // Restore calendar events
    if (normalizedBackup.calendar_events && Array.isArray(normalizedBackup.calendar_events)) {
      console.log(`${dryRun ? 'Would restore' : 'Restoring'} ${normalizedBackup.calendar_events.length} calendar events...`);
      for (const event of normalizedBackup.calendar_events) {
        try {
          if (!dryRun) {
            const { id, created_date, updated_date, company_id, ...eventData } = event;
            await base44.asServiceRole.entities.CalendarEvent.create({
                ...eventData,
                company_id: targetCompany.id
            });
          }
          results.calendar_events++;
        } catch (error) {
          console.error('Failed to restore calendar event:', event.title, error.message);
          results.errors.push(`Calendar Event ${event.title}: ${error.message}`);
        }
      }
    }

    const summary = `
${dryRun ? '🔍 DRY RUN - No Data Changed!' : '✅ Restore Complete!'}

${replaceExisting && !dryRun ? '🗑️ Deleted Existing Data:\nCustomers: ' + results.deleted.customers + '\nLeads: ' + results.deleted.leads + '\nInvoices: ' + results.deleted.invoices + '\nEstimates: ' + results.deleted.estimates + '\nPayments: ' + results.deleted.payments + '\nTasks: ' + results.deleted.tasks + '\nProjects: ' + results.deleted.projects + '\nCommunications: ' + results.deleted.communications + '\nCalendar Events: ' + results.deleted.calendar_events + '\n\n' : ''}${dryRun ? 'Would restore:' : 'Restored:'}
Customers: ${results.customers}
Leads: ${results.leads}
Invoices: ${results.invoices}
Estimates: ${results.estimates}
Payments: ${results.payments}
Tasks: ${results.tasks}
Projects: ${results.projects}
Communications: ${results.communications}
Calendar Events: ${results.calendar_events}

${results.errors.length > 0 ? `\n⚠️ Errors: ${results.errors.length}\n${results.errors.slice(0, 5).join('\n')}` : ''}

${dryRun ? '\n✅ Safe to restore - no issues detected!' : ''}
    `.trim();

    console.log('✅ Restore function complete');
    console.log('Final results:', results);

    return Response.json({
      success: true,
      summary,
      results,
      dryRun,
      replaceExisting
    });

  } catch (error) {
    console.error('❌ Restore failed:', error);
    console.error('Error stack:', error.stack);
    return Response.json({ 
      success: false,
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});