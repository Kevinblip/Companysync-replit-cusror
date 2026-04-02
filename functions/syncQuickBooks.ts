import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, data } = await req.json();

    // Get QuickBooks credentials
    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
    const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
    const refreshToken = Deno.env.get('QUICKBOOKS_REFRESH_TOKEN');
    const realmId = Deno.env.get('QUICKBOOKS_REALM_ID');

    if (!clientId || !clientSecret || !refreshToken || !realmId) {
      return Response.json({ error: 'QuickBooks credentials not configured' }, { status: 400 });
    }

    // Refresh access token
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

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return Response.json({ error: 'Failed to refresh token', details: error }, { status: 500 });
    }

    const { access_token } = await tokenResponse.json();

    // QuickBooks API base URL (Sandbox)
    const apiBase = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;

    // Route actions
    switch (action) {
      case 'sync_invoice': {
        const { invoice } = data;
        
        // Check if customer exists in QuickBooks
        const customerQuery = await fetch(
          `${apiBase}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${invoice.customer_name}'`)}`,
          {
            headers: {
              'Authorization': `Bearer ${access_token}`,
              'Accept': 'application/json'
            }
          }
        );

        let customerId;
        const customerData = await customerQuery.json();
        
        if (customerData.QueryResponse.Customer && customerData.QueryResponse.Customer.length > 0) {
          customerId = customerData.QueryResponse.Customer[0].Id;
        } else {
          // Create customer
          const newCustomer = await fetch(`${apiBase}/customer`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${access_token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              DisplayName: invoice.customer_name,
              PrimaryEmailAddr: invoice.customer_email ? { Address: invoice.customer_email } : undefined
            })
          });

          const createdCustomer = await newCustomer.json();
          customerId = createdCustomer.Customer.Id;
        }

        // Create invoice in QuickBooks
        const qbInvoice = {
          CustomerRef: {
            value: customerId
          },
          Line: invoice.items.map(item => ({
            DetailType: 'SalesItemLineDetail',
            Amount: item.amount,
            Description: item.description,
            SalesItemLineDetail: {
              Qty: item.quantity,
              UnitPrice: item.rate
            }
          })),
          TxnDate: invoice.issue_date || new Date().toISOString().split('T')[0],
          DueDate: invoice.due_date
        };

        const qbInvoiceResponse = await fetch(`${apiBase}/invoice`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(qbInvoice)
        });

        const createdInvoice = await qbInvoiceResponse.json();

        return Response.json({
          success: true,
          quickbooks_invoice_id: createdInvoice.Invoice.Id,
          message: 'Invoice synced to QuickBooks'
        });
      }

      case 'sync_payment': {
        const { payment, invoice } = data;

        // Create payment to Undeposited Funds (to avoid double-counting revenue)
        const qbPayment = {
          TotalAmt: payment.amount,
          CustomerRef: {
            value: invoice.quickbooks_customer_id || '1' // You'll need to store this
          },
          DepositToAccountRef: {
            value: '4' // Undeposited Funds account ID (standard in QuickBooks)
          },
          Line: [{
            Amount: payment.amount,
            LinkedTxn: invoice.quickbooks_invoice_id ? [{
              TxnId: invoice.quickbooks_invoice_id,
              TxnType: 'Invoice'
            }] : []
          }]
        };

        const qbPaymentResponse = await fetch(`${apiBase}/payment`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(qbPayment)
        });

        const createdPayment = await qbPaymentResponse.json();

        return Response.json({
          success: true,
          quickbooks_payment_id: createdPayment.Payment.Id,
          message: 'Payment synced to Undeposited Funds'
        });
      }

      case 'sync_expense': {
        const { expense } = data;

        const qbExpense = {
          TotalAmt: expense.amount,
          Line: [{
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: expense.amount,
            Description: expense.description,
            AccountBasedExpenseLineDetail: {
              AccountRef: {
                value: '7' // Default expense account (you can customize)
              }
            }
          }],
          TxnDate: expense.expense_date || new Date().toISOString().split('T')[0]
        };

        const qbExpenseResponse = await fetch(`${apiBase}/purchase`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(qbExpense)
        });

        const createdExpense = await qbExpenseResponse.json();

        return Response.json({
          success: true,
          quickbooks_expense_id: createdExpense.Purchase.Id,
          message: 'Expense synced to QuickBooks'
        });
      }

      case 'test_connection': {
        const companyInfoResponse = await fetch(`${apiBase}/companyinfo/${realmId}`, {
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Accept': 'application/json'
          }
        });

        const companyInfo = await companyInfoResponse.json();

        return Response.json({
          success: true,
          company_name: companyInfo.CompanyInfo.CompanyName,
          message: 'QuickBooks connection successful'
        });
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('QuickBooks sync error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});