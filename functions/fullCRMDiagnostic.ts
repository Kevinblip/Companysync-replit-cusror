import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Starting comprehensive CRM diagnostic...');

    const report = {
      timestamp: new Date().toISOString(),
      user: user.email,
      sections: []
    };

    // ========== SECTION 1: Company & User Setup ==========
    console.log('\n🏢 SECTION 1: Company & User Setup...');
    const companySection = {
      title: '1. Company & User Configuration',
      status: 'checking',
      details: {}
    };

    try {
      const companies = await base44.asServiceRole.entities.Company.list("-created_date", 100);
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      const allStaffProfiles = await base44.asServiceRole.entities.StaffProfile.list("-created_date", 1000);
      const roles = await base44.asServiceRole.entities.StaffRole.list("-created_date", 100);

      companySection.details.totalCompanies = companies.length;
      companySection.details.duplicateCompanies = companies.length > 1;
      companySection.details.yourStaffProfiles = staffProfiles.length;
      companySection.details.totalStaffMembers = allStaffProfiles.length;
      companySection.details.totalRoles = roles.length;

      const myCompany = companies.find(c => c.created_by === user.email) || companies[0];
      companySection.details.companyName = myCompany?.company_name || 'Not set';
      companySection.details.companySetupComplete = myCompany?.setup_completed || false;
      companySection.details.hasLogo = !!myCompany?.logo_url;

      if (companies.length > 1) {
        companySection.status = 'error';
        companySection.summary = `❌ ${companies.length} duplicate companies detected - causing data visibility issues`;
        companySection.recommendation = 'Run "cleanupAllOrphanedData" from Utilities page';
      } else {
        companySection.status = 'success';
        companySection.summary = `✅ Company: ${myCompany?.company_name || 'Unknown'}`;
      }

      report.sections.push(companySection);
    } catch (error) {
      companySection.status = 'error';
      companySection.summary = '❌ Failed to fetch company data';
      companySection.details.error = error.message;
      report.sections.push(companySection);
    }

    // ========== SECTION 2: Data Inventory ==========
    console.log('\n📊 SECTION 2: Data Inventory...');
    const dataSection = {
      title: '2. Core Data Inventory',
      status: 'checking',
      details: {}
    };

    try {
      const [customers, leads, invoices, estimates, payments, projects, tasks, events] = await Promise.all([
        base44.asServiceRole.entities.Customer.list('-created_date', 10000),
        base44.asServiceRole.entities.Lead.list('-created_date', 10000),
        base44.asServiceRole.entities.Invoice.list('-created_date', 10000),
        base44.asServiceRole.entities.Estimate.list('-created_date', 10000),
        base44.asServiceRole.entities.Payment.list('-created_date', 10000),
        base44.asServiceRole.entities.Project.list('-created_date', 10000),
        base44.asServiceRole.entities.Task.list('-created_date', 10000),
        base44.asServiceRole.entities.CalendarEvent.list('-created_date', 10000)
      ]);

      dataSection.details = {
        customers: customers.length,
        leads: leads.length,
        invoices: invoices.length,
        estimates: estimates.length,
        payments: payments.length,
        projects: projects.length,
        tasks: tasks.length,
        calendarEvents: events.length
      };

      dataSection.status = 'success';
      dataSection.summary = `✅ Total records: ${customers.length + leads.length + invoices.length + estimates.length + payments.length + projects.length + tasks.length + events.length}`;
      report.sections.push(dataSection);

      // Store for later sections
      report._rawData = { customers, leads, invoices, estimates, payments, projects, tasks, events };

    } catch (error) {
      dataSection.status = 'error';
      dataSection.summary = '❌ Failed to fetch data inventory';
      dataSection.details.error = error.message;
      report.sections.push(dataSection);
    }

    // ========== SECTION 3: Financial Health ==========
    console.log('\n💰 SECTION 3: Financial Health...');
    const financialSection = {
      title: '3. Financial Health',
      status: 'checking',
      details: {}
    };

    try {
      const { invoices, payments } = report._rawData;

      const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
      const totalPayments = payments.reduce((sum, pay) => sum + (pay.amount || 0), 0);
      const paidInvoices = invoices.filter(inv => inv.status === 'paid');
      const unpaidInvoices = invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled');
      const outstandingBalance = unpaidInvoices.reduce((sum, inv) => sum + (inv.amount || 0) - (inv.amount_paid || 0), 0);

      // Check for duplicate payments
      const paymentsByKey = {};
      let duplicatePayments = 0;
      payments.forEach(pay => {
        const key = `${pay.customer_name}_${pay.amount}_${pay.payment_date}_${pay.reference_number}`;
        paymentsByKey[key] = (paymentsByKey[key] || 0) + 1;
        if (paymentsByKey[key] > 1) duplicatePayments++;
      });

      financialSection.details = {
        totalInvoiceAmount: `$${totalInvoiceAmount.toLocaleString()}`,
        totalPaymentsReceived: `$${totalPayments.toLocaleString()}`,
        paidInvoices: paidInvoices.length,
        unpaidInvoices: unpaidInvoices.length,
        outstandingBalance: `$${outstandingBalance.toLocaleString()}`,
        duplicatePayments: duplicatePayments
      };

      if (duplicatePayments > 0) {
        financialSection.status = 'warning';
        financialSection.summary = `⚠️ ${duplicatePayments} duplicate payments detected - inflating revenue`;
        financialSection.recommendation = 'Run "deleteDuplicatePayments" from Utilities';
      } else if (outstandingBalance > 0) {
        financialSection.status = 'warning';
        financialSection.summary = `⚠️ Outstanding balance: $${outstandingBalance.toLocaleString()}`;
      } else {
        financialSection.status = 'success';
        financialSection.summary = `✅ Total revenue: $${totalPayments.toLocaleString()}`;
      }

      report.sections.push(financialSection);
    } catch (error) {
      financialSection.status = 'error';
      financialSection.summary = '❌ Failed to analyze financial health';
      financialSection.details.error = error.message;
      report.sections.push(financialSection);
    }

    // ========== SECTION 4: Data Integrity ==========
    console.log('\n🔗 SECTION 4: Data Integrity...');
    const integritySection = {
      title: '4. Data Integrity & Linkage',
      status: 'checking',
      details: {}
    };

    try {
      const { customers, invoices, estimates, payments, tasks } = report._rawData;

      // Check invoice-customer links
      const invoicesWithCustomerId = invoices.filter(inv => inv.customer_id);
      const invoicesWithoutCustomerId = invoices.filter(inv => !inv.customer_id);

      // Check estimate-customer links
      const estimatesWithCustomerId = estimates.filter(est => est.customer_id);
      const estimatesWithoutCustomerId = estimates.filter(est => !est.customer_id);

      // Check payment-invoice links
      const paymentsWithInvoiceId = payments.filter(pay => pay.invoice_id);
      const paymentsWithoutInvoiceId = payments.filter(pay => !pay.invoice_id);

      // Check tasks without related_to
      const tasksWithoutRelation = tasks.filter(task => !task.related_to);

      // Check orphaned payments (no company_id)
      const orphanedPayments = payments.filter(pay => !pay.company_id);

      // Check duplicate customers
      const customersByName = {};
      customers.forEach(cust => {
        const key = cust.name?.toLowerCase().trim();
        if (key) {
          customersByName[key] = (customersByName[key] || 0) + 1;
        }
      });
      const duplicateCustomers = Object.values(customersByName).filter(count => count > 1).length;

      integritySection.details = {
        invoices: {
          total: invoices.length,
          linkedToCustomer: invoicesWithCustomerId.length,
          unlinked: invoicesWithoutCustomerId.length,
          linkageRate: `${((invoicesWithCustomerId.length / invoices.length) * 100).toFixed(1)}%`
        },
        estimates: {
          total: estimates.length,
          linkedToCustomer: estimatesWithCustomerId.length,
          unlinked: estimatesWithoutCustomerId.length,
          linkageRate: `${((estimatesWithCustomerId.length / estimates.length) * 100).toFixed(1)}%`
        },
        payments: {
          total: payments.length,
          linkedToInvoice: paymentsWithInvoiceId.length,
          unlinked: paymentsWithoutInvoiceId.length,
          orphaned: orphanedPayments.length
        },
        tasks: {
          total: tasks.length,
          withoutRelation: tasksWithoutRelation.length
        },
        customers: {
          total: customers.length,
          duplicateGroups: duplicateCustomers
        }
      };

      const hasIssues = invoicesWithoutCustomerId.length > 0 || 
                        estimatesWithoutCustomerId.length > 0 || 
                        orphanedPayments.length > 0 ||
                        duplicateCustomers > 0;

      if (hasIssues) {
        integritySection.status = 'warning';
        integritySection.summary = `⚠️ Data integrity issues detected`;
        integritySection.recommendations = [];
        if (invoicesWithoutCustomerId.length > 0) {
          integritySection.recommendations.push(`Link ${invoicesWithoutCustomerId.length} invoices to customers`);
        }
        if (estimatesWithoutCustomerId.length > 0) {
          integritySection.recommendations.push(`Link ${estimatesWithoutCustomerId.length} estimates to customers`);
        }
        if (orphanedPayments.length > 0) {
          integritySection.recommendations.push(`Fix ${orphanedPayments.length} orphaned payments`);
        }
        if (duplicateCustomers > 0) {
          integritySection.recommendations.push(`Merge ${duplicateCustomers} duplicate customer groups`);
        }
      } else {
        integritySection.status = 'success';
        integritySection.summary = `✅ All data properly linked`;
      }

      report.sections.push(integritySection);
    } catch (error) {
      integritySection.status = 'error';
      integritySection.summary = '❌ Failed to check data integrity';
      integritySection.details.error = error.message;
      report.sections.push(integritySection);
    }

    // ========== SECTION 5: Assignment & Ownership ==========
    console.log('\n👥 SECTION 5: Assignment & Ownership...');
    const assignmentSection = {
      title: '5. Assignment & Ownership',
      status: 'checking',
      details: {}
    };

    try {
      const { customers, invoices, leads, tasks } = report._rawData;

      const customersWithAssignment = customers.filter(c => 
        c.assigned_to || (c.assigned_to_users && c.assigned_to_users.length > 0)
      );
      const unassignedCustomers = customers.filter(c => 
        !c.assigned_to && (!c.assigned_to_users || c.assigned_to_users.length === 0)
      );

      const invoicesWithCommission = invoices.filter(inv => 
        inv.commission_splits && inv.commission_splits.length > 0
      );
      const invoicesWithoutCommission = invoices.filter(inv => 
        !inv.commission_splits || inv.commission_splits.length === 0
      );

      const leadsWithAssignment = leads.filter(l => 
        l.assigned_to || (l.assigned_to_users && l.assigned_to_users.length > 0)
      );
      const unassignedLeads = leads.filter(l => 
        !l.assigned_to && (!l.assigned_to_users || l.assigned_to_users.length === 0)
      );

      const tasksWithAssignment = tasks.filter(t => 
        t.assignees && t.assignees.length > 0
      );
      const unassignedTasks = tasks.filter(t => 
        !t.assignees || t.assignees.length === 0
      );

      assignmentSection.details = {
        customers: {
          total: customers.length,
          assigned: customersWithAssignment.length,
          unassigned: unassignedCustomers.length,
          assignmentRate: `${((customersWithAssignment.length / customers.length) * 100).toFixed(1)}%`
        },
        invoices: {
          total: invoices.length,
          withCommission: invoicesWithCommission.length,
          withoutCommission: invoicesWithoutCommission.length,
          commissionRate: `${((invoicesWithCommission.length / invoices.length) * 100).toFixed(1)}%`
        },
        leads: {
          total: leads.length,
          assigned: leadsWithAssignment.length,
          unassigned: unassignedLeads.length
        },
        tasks: {
          total: tasks.length,
          assigned: tasksWithAssignment.length,
          unassigned: unassignedTasks.length
        }
      };

      const hasUnassigned = unassignedCustomers.length > 0 || 
                           invoicesWithoutCommission.length > 0 || 
                           unassignedLeads.length > 0;

      if (hasUnassigned) {
        assignmentSection.status = 'warning';
        assignmentSection.summary = `⚠️ Unassigned records detected`;
        assignmentSection.recommendations = [];
        if (unassignedCustomers.length > 0) {
          assignmentSection.recommendations.push(`Assign ${unassignedCustomers.length} customers`);
        }
        if (invoicesWithoutCommission.length > 0) {
          assignmentSection.recommendations.push(`Assign commissions to ${invoicesWithoutCommission.length} invoices`);
        }
        if (unassignedLeads.length > 0) {
          assignmentSection.recommendations.push(`Assign ${unassignedLeads.length} leads`);
        }
      } else {
        assignmentSection.status = 'success';
        assignmentSection.summary = `✅ All records properly assigned`;
      }

      report.sections.push(assignmentSection);
    } catch (error) {
      assignmentSection.status = 'error';
      assignmentSection.summary = '❌ Failed to check assignments';
      assignmentSection.details.error = error.message;
      report.sections.push(assignmentSection);
    }

    // ========== SECTION 6: Integration Status ==========
    console.log('\n🔌 SECTION 6: Integration Status...');
    const integrationSection = {
      title: '6. Integration Status',
      status: 'checking',
      details: {}
    };

    try {
      const integrationSettings = await base44.asServiceRole.entities.IntegrationSetting.list('-created_date', 100);
      
      integrationSection.details.totalIntegrations = integrationSettings.length;
      integrationSection.details.enabledIntegrations = integrationSettings.filter(i => i.is_enabled).length;
      
      const integrationsByName = {};
      integrationSettings.forEach(setting => {
        integrationsByName[setting.integration_name] = setting.is_enabled ? '✅ Enabled' : '❌ Disabled';
      });
      integrationSection.details.integrations = integrationsByName;

      // Check environment secrets
      const hasQuickBooks = Deno.env.get('QUICKBOOKS_CLIENT_ID') ? '✅ Configured' : '❌ Not configured';
      const hasGHL = Deno.env.get('GHL_API_KEY') ? '✅ Configured' : '❌ Not configured';
      const hasStripe = Deno.env.get('STRIPE_SECRET_KEY') ? '✅ Configured' : '❌ Not configured';
      const hasTwilio = integrationSettings.find(i => i.integration_name === 'Twilio')?.is_enabled ? '✅ Enabled' : '❌ Not enabled';

      integrationSection.details.keyIntegrations = {
        QuickBooks: hasQuickBooks,
        GoHighLevel: hasGHL,
        Stripe: hasStripe,
        Twilio: hasTwilio
      };

      integrationSection.status = 'success';
      integrationSection.summary = `✅ ${integrationSettings.filter(i => i.is_enabled).length} integrations active`;
      report.sections.push(integrationSection);

    } catch (error) {
      integrationSection.status = 'error';
      integrationSection.summary = '❌ Failed to check integration status';
      integrationSection.details.error = error.message;
      report.sections.push(integrationSection);
    }

    // ========== SECTION 7: System Health ==========
    console.log('\n⚙️ SECTION 7: System Health...');
    const systemSection = {
      title: '7. System Configuration',
      status: 'checking',
      details: {}
    };

    try {
      const [emailTemplates, smsTemplates, workflows, notifications] = await Promise.all([
        base44.asServiceRole.entities.EmailTemplate.list('-created_date', 100),
        base44.asServiceRole.entities.SMSTemplate.list('-created_date', 100),
        base44.asServiceRole.entities.Workflow.list('-created_date', 100),
        base44.asServiceRole.entities.Notification.list('-created_date', 100)
      ]);

      systemSection.details = {
        emailTemplates: emailTemplates.length,
        smsTemplates: smsTemplates.length,
        workflows: workflows.length,
        activeWorkflows: workflows.filter(w => w.is_active).length,
        totalNotifications: notifications.length,
        unreadNotifications: notifications.filter(n => !n.is_read).length
      };

      systemSection.status = 'success';
      systemSection.summary = `✅ System configured with ${workflows.filter(w => w.is_active).length} active workflows`;
      report.sections.push(systemSection);

    } catch (error) {
      systemSection.status = 'error';
      systemSection.summary = '❌ Failed to check system configuration';
      systemSection.details.error = error.message;
      report.sections.push(systemSection);
    }

    // ========== OVERALL STATUS ==========
    const errorSections = report.sections.filter(s => s.status === 'error');
    const warningSections = report.sections.filter(s => s.status === 'warning');
    const successSections = report.sections.filter(s => s.status === 'success');

    report.overallStatus = {
      errors: errorSections.length,
      warnings: warningSections.length,
      success: successSections.length,
      totalSections: report.sections.length
    };

    if (errorSections.length > 0) {
      report.overallMessage = `❌ ${errorSections.length} critical issues requiring immediate attention`;
      report.healthScore = Math.round((successSections.length / report.sections.length) * 100);
    } else if (warningSections.length > 0) {
      report.overallMessage = `⚠️ ${warningSections.length} warnings detected - system functional but needs optimization`;
      report.healthScore = Math.round((successSections.length / report.sections.length) * 100);
    } else {
      report.overallMessage = `✅ CRM is healthy - all systems operational`;
      report.healthScore = 100;
    }

    // ========== ACTION ITEMS ==========
    report.actionItems = [];
    
    report.sections.forEach(section => {
      if (section.recommendation) {
        report.actionItems.push({
          priority: section.status === 'error' ? 'HIGH' : 'MEDIUM',
          section: section.title,
          action: section.recommendation
        });
      }
      if (section.recommendations) {
        section.recommendations.forEach(rec => {
          report.actionItems.push({
            priority: section.status === 'error' ? 'HIGH' : 'MEDIUM',
            section: section.title,
            action: rec
          });
        });
      }
    });

    // Clean up raw data before returning
    delete report._rawData;

    console.log('✅ Diagnostic complete!');
    return Response.json(report);

  } catch (error) {
    console.error('❌ Diagnostic error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});