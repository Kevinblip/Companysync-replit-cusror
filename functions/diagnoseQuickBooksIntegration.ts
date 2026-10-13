import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Starting comprehensive QuickBooks diagnostic...');

    const report = {
      timestamp: new Date().toISOString(),
      sections: []
    };

    // ========== SECTION 1: Credentials Check ==========
    console.log('\n📋 SECTION 1: Checking QuickBooks Credentials...');
    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
    const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
    const refreshToken = Deno.env.get('QUICKBOOKS_REFRESH_TOKEN');
    const realmId = Deno.env.get('QUICKBOOKS_REALM_ID');

    const credentialsSection = {
      title: '1. Credentials Status',
      status: 'checking',
      details: {
        clientId: clientId ? '✅ Set' : '❌ Missing',
        clientSecret: clientSecret ? '✅ Set' : '❌ Missing',
        refreshToken: refreshToken ? '✅ Set' : '❌ Missing',
        realmId: realmId ? '✅ Set' : '❌ Missing'
      }
    };

    const allCredsSet = clientId && clientSecret && refreshToken && realmId;
    credentialsSection.status = allCredsSet ? 'success' : 'error';
    credentialsSection.summary = allCredsSet 
      ? '✅ All credentials configured'
      : '❌ Missing credentials - need to reconnect QuickBooks';
    
    report.sections.push(credentialsSection);

    if (!allCredsSet) {
      report.overallStatus = 'error';
      report.overallMessage = '❌ Cannot proceed - QuickBooks credentials missing. Please reconnect your QuickBooks account.';
      return Response.json(report);
    }

    // ========== SECTION 2: OAuth Token Refresh ==========
    console.log('\n🔐 SECTION 2: Testing OAuth Token Refresh...');
    const tokenSection = {
      title: '2. OAuth Token Refresh',
      status: 'checking',
      details: {}
    };

    try {
      const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`)
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      });

      tokenSection.details.responseStatus = tokenResponse.status;

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        tokenSection.status = 'error';
        tokenSection.summary = '❌ Token refresh failed';
        tokenSection.details.error = errorText;
        tokenSection.details.errorParsed = JSON.parse(errorText);
        tokenSection.recommendation = 'Your refresh token is expired or invalid. You need to reconnect QuickBooks via OAuth.';
        report.sections.push(tokenSection);
        report.overallStatus = 'error';
        report.overallMessage = '❌ QuickBooks connection expired. Please reconnect your QuickBooks account.';
        return Response.json(report);
      }

      const tokenData = await tokenResponse.json();
      tokenSection.status = 'success';
      tokenSection.summary = '✅ Successfully obtained access token';
      tokenSection.details.tokenExpiresIn = `${tokenData.expires_in} seconds`;
      tokenSection.details.refreshTokenExpiresIn = `${tokenData.x_refresh_token_expires_in} seconds`;
      report.sections.push(tokenSection);

      const accessToken = tokenData.access_token;

      // ========== SECTION 3: API Connectivity ==========
      console.log('\n🌐 SECTION 3: Testing QuickBooks API Connectivity...');
      const apiSection = {
        title: '3. QuickBooks API Connection',
        status: 'checking',
        details: {}
      };

      const apiBase = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;
      
      const companyInfoResponse = await fetch(`${apiBase}/companyinfo/${realmId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      apiSection.details.responseStatus = companyInfoResponse.status;

      if (!companyInfoResponse.ok) {
        const errorText = await companyInfoResponse.text();
        apiSection.status = 'error';
        apiSection.summary = '❌ API call failed';
        apiSection.details.error = errorText;
        report.sections.push(apiSection);
        report.overallStatus = 'error';
        report.overallMessage = '❌ Cannot connect to QuickBooks API';
        return Response.json(report);
      }

      const companyInfo = await companyInfoResponse.json();
      apiSection.status = 'success';
      apiSection.summary = `✅ Connected to: ${companyInfo.CompanyInfo.CompanyName}`;
      apiSection.details.companyName = companyInfo.CompanyInfo.CompanyName;
      apiSection.details.country = companyInfo.CompanyInfo.Country;
      apiSection.details.realmId = realmId;
      report.sections.push(apiSection);

      // ========== SECTION 4: CRM Data Inventory ==========
      console.log('\n📊 SECTION 4: Analyzing CRM Data...');
      const crmDataSection = {
        title: '4. CRM Data Inventory',
        status: 'checking',
        details: {}
      };

      try {
        const [customers, invoices, payments, expenses] = await Promise.all([
          base44.asServiceRole.entities.Customer.list('-created_date', 1000),
          base44.asServiceRole.entities.Invoice.list('-created_date', 1000),
          base44.asServiceRole.entities.Payment.list('-created_date', 1000),
          base44.asServiceRole.entities.Expense.list('-created_date', 1000)
        ]);

        crmDataSection.details.totalCustomers = customers.length;
        crmDataSection.details.totalInvoices = invoices.length;
        crmDataSection.details.totalPayments = payments.length;
        crmDataSection.details.totalExpenses = expenses.length;

        // Check sync status
        const syncedInvoices = invoices.filter(inv => inv.quickbooks_invoice_id);
        const syncedPayments = payments.filter(pay => pay.quickbooks_payment_id);
        const syncedExpenses = expenses.filter(exp => exp.quickbooks_expense_id);

        crmDataSection.details.syncedInvoices = syncedInvoices.length;
        crmDataSection.details.unsyncedInvoices = invoices.length - syncedInvoices.length;
        crmDataSection.details.syncedPayments = syncedPayments.length;
        crmDataSection.details.unsyncedPayments = payments.length - syncedPayments.length;
        crmDataSection.details.syncedExpenses = syncedExpenses.length;
        crmDataSection.details.unsyncedExpenses = expenses.length - syncedExpenses.length;

        crmDataSection.status = 'success';
        crmDataSection.summary = `✅ Found ${customers.length} customers, ${invoices.length} invoices, ${payments.length} payments, ${expenses.length} expenses`;
        report.sections.push(crmDataSection);

      } catch (error) {
        crmDataSection.status = 'error';
        crmDataSection.summary = '❌ Failed to fetch CRM data';
        crmDataSection.details.error = error.message;
        report.sections.push(crmDataSection);
      }

      // ========== SECTION 5: QuickBooks Data Inventory ==========
      console.log('\n📊 SECTION 5: Analyzing QuickBooks Data...');
      const qbDataSection = {
        title: '5. QuickBooks Data Inventory',
        status: 'checking',
        details: {}
      };

      try {
        // Query QuickBooks customers
        const customersQuery = await fetch(
          `${apiBase}/query?query=${encodeURIComponent("SELECT COUNT(*) FROM Customer")}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            }
          }
        );
        const customersData = await customersQuery.json();
        qbDataSection.details.qbCustomers = customersData.QueryResponse.totalCount || 0;

        // Query QuickBooks invoices
        const invoicesQuery = await fetch(
          `${apiBase}/query?query=${encodeURIComponent("SELECT COUNT(*) FROM Invoice")}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            }
          }
        );
        const invoicesData = await invoicesQuery.json();
        qbDataSection.details.qbInvoices = invoicesData.QueryResponse.totalCount || 0;

        // Query QuickBooks payments
        const paymentsQuery = await fetch(
          `${apiBase}/query?query=${encodeURIComponent("SELECT COUNT(*) FROM Payment")}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            }
          }
        );
        const paymentsData = await paymentsQuery.json();
        qbDataSection.details.qbPayments = paymentsData.QueryResponse.totalCount || 0;

        // Query QuickBooks purchases (expenses)
        const expensesQuery = await fetch(
          `${apiBase}/query?query=${encodeURIComponent("SELECT COUNT(*) FROM Purchase")}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            }
          }
        );
        const expensesData = await expensesQuery.json();
        qbDataSection.details.qbExpenses = expensesData.QueryResponse.totalCount || 0;

        qbDataSection.status = 'success';
        qbDataSection.summary = `✅ QuickBooks has ${qbDataSection.details.qbCustomers} customers, ${qbDataSection.details.qbInvoices} invoices, ${qbDataSection.details.qbPayments} payments, ${qbDataSection.details.qbExpenses} expenses`;
        report.sections.push(qbDataSection);

      } catch (error) {
        qbDataSection.status = 'error';
        qbDataSection.summary = '❌ Failed to query QuickBooks data';
        qbDataSection.details.error = error.message;
        report.sections.push(qbDataSection);
      }

      // ========== SECTION 6: Chart of Accounts ==========
      console.log('\n📊 SECTION 6: Checking Chart of Accounts...');
      const coaSection = {
        title: '6. Chart of Accounts',
        status: 'checking',
        details: {}
      };

      try {
        const coaQuery = await fetch(
          `${apiBase}/query?query=${encodeURIComponent("SELECT * FROM Account")}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            }
          }
        );
        const coaData = await coaQuery.json();
        const accounts = coaData.QueryResponse.Account || [];

        coaSection.details.totalAccounts = accounts.length;
        coaSection.details.accountsByType = accounts.reduce((acc, acct) => {
          acc[acct.AccountType] = (acc[acct.AccountType] || 0) + 1;
          return acc;
        }, {});

        // Find key accounts
        const undepositedFunds = accounts.find(a => a.Name.includes('Undeposited Funds'));
        const accountsReceivable = accounts.find(a => a.AccountType === 'Accounts Receivable');
        const income = accounts.find(a => a.AccountType === 'Income');

        coaSection.details.keyAccounts = {
          undepositedFunds: undepositedFunds ? `✅ ${undepositedFunds.Name} (ID: ${undepositedFunds.Id})` : '❌ Not found',
          accountsReceivable: accountsReceivable ? `✅ ${accountsReceivable.Name} (ID: ${accountsReceivable.Id})` : '❌ Not found',
          income: income ? `✅ ${income.Name} (ID: ${income.Id})` : '❌ Not found'
        };

        coaSection.status = 'success';
        coaSection.summary = `✅ Found ${accounts.length} accounts`;
        report.sections.push(coaSection);

      } catch (error) {
        coaSection.status = 'error';
        coaSection.summary = '❌ Failed to fetch Chart of Accounts';
        coaSection.details.error = error.message;
        report.sections.push(coaSection);
      }

      // ========== SECTION 7: Test Customer Creation ==========
      console.log('\n🧪 SECTION 7: Testing Customer Creation...');
      const testCustomerSection = {
        title: '7. Test Customer Creation',
        status: 'checking',
        details: {}
      };

      try {
        const testCustomer = {
          DisplayName: `Test Customer ${Date.now()}`
        };

        const createResponse = await fetch(`${apiBase}/customer`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(testCustomer)
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          testCustomerSection.status = 'error';
          testCustomerSection.summary = '❌ Failed to create test customer';
          testCustomerSection.details.error = errorText;
        } else {
          const createdCustomer = await createResponse.json();
          testCustomerSection.status = 'success';
          testCustomerSection.summary = `✅ Successfully created test customer`;
          testCustomerSection.details.customerId = createdCustomer.Customer.Id;
          testCustomerSection.details.customerName = createdCustomer.Customer.DisplayName;

          // Clean up - delete test customer
          try {
            const deleteResponse = await fetch(`${apiBase}/customer?operation=delete`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                Id: createdCustomer.Customer.Id,
                SyncToken: createdCustomer.Customer.SyncToken
              })
            });
            testCustomerSection.details.cleanup = deleteResponse.ok ? '✅ Test customer deleted' : '⚠️ Could not delete test customer';
          } catch (e) {
            testCustomerSection.details.cleanup = '⚠️ Could not delete test customer';
          }
        }

        report.sections.push(testCustomerSection);

      } catch (error) {
        testCustomerSection.status = 'error';
        testCustomerSection.summary = '❌ Customer creation test failed';
        testCustomerSection.details.error = error.message;
        report.sections.push(testCustomerSection);
      }

      // ========== OVERALL STATUS ==========
      const hasErrors = report.sections.some(s => s.status === 'error');
      const hasWarnings = report.sections.some(s => s.status === 'warning');

      if (hasErrors) {
        report.overallStatus = 'error';
        report.overallMessage = '❌ QuickBooks integration has issues that need attention';
      } else if (hasWarnings) {
        report.overallStatus = 'warning';
        report.overallMessage = '⚠️ QuickBooks integration is working but has warnings';
      } else {
        report.overallStatus = 'success';
        report.overallMessage = '✅ QuickBooks integration is fully operational';
      }

      // ========== RECOMMENDATIONS ==========
      report.recommendations = [];

      const crmData = report.sections.find(s => s.title === '4. CRM Data Inventory');
      if (crmData && crmData.details.unsyncedInvoices > 0) {
        report.recommendations.push(`📤 Sync ${crmData.details.unsyncedInvoices} unsynced invoices to QuickBooks`);
      }
      if (crmData && crmData.details.unsyncedPayments > 0) {
        report.recommendations.push(`💰 Sync ${crmData.details.unsyncedPayments} unsynced payments to QuickBooks`);
      }
      if (crmData && crmData.details.unsyncedExpenses > 0) {
        report.recommendations.push(`🧾 Sync ${crmData.details.unsyncedExpenses} unsynced expenses to QuickBooks`);
      }

      return Response.json(report);

    } catch (error) {
      tokenSection.status = 'error';
      tokenSection.summary = '❌ Token refresh failed';
      tokenSection.details.error = error.message;
      report.sections.push(tokenSection);
      report.overallStatus = 'error';
      report.overallMessage = '❌ Unexpected error during token refresh';
      return Response.json(report);
    }

  } catch (error) {
    console.error('❌ Diagnostic error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});