import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let dateRange = 'this_month';
    try {
      const body = await req.json();
      dateRange = body.dateRange || 'this_month';
    } catch (e) {
      // No body provided, use default
    }

    const apiKey = Deno.env.get('ONLINECHECKWRITER_API_KEY');
    if (!apiKey) {
      return Response.json({ 
        success: false,
        error: 'Online Check Writer API key not configured',
        hint: 'Please contact Online Check Writer support to get API access and documentation at support@onlinecheckwriter.com'
      }, { status: 500 });
    }

    // Fetch company ID for the current user
    const companies = await base44.entities.Company.filter({ created_by: user.email });
    const company = companies[0];
    
    if (!company) {
      return Response.json({ 
        success: false,
        error: 'Company not found' 
      }, { status: 404 });
    }

    // Calculate date range
    const now = new Date();
    let startDate;
    
    if (dateRange === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (dateRange === 'this_week') {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.setDate(now.getDate() - dayOfWeek));
      startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === 'this_month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dateRange === 'last_3_months') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    } else if (dateRange === 'this_year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Fetch checks from Online Check Writer API v3
    // Base URL: https://app.onlinecheckwriter.com/api/v3
    console.log('Attempting to fetch checks from Online Check Writer...');
    console.log('Using API key:', apiKey ? 'Present (length: ' + apiKey.length + ')' : 'Missing');
    
    let response;
    try {
      response = await fetch('https://app.onlinecheckwriter.com/api/v3/checks', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      return Response.json({ 
        success: false,
        error: 'Unable to connect to Online Check Writer API',
        details: fetchError.message,
        hint: 'Contact support@onlinecheckwriter.com to activate Live API access'
      }, { status: 500 });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OCW API Error:', response.status, errorText);
      
      let hint = 'Check if your API key is correct and has the right permissions';
      if (response.status === 404) {
        hint = '404 Error: The API endpoint may have changed. Please verify the correct Online Check Writer API endpoint URL in their documentation.';
      }
      
      return Response.json({ 
        success: false,
        error: `Online Check Writer API returned status ${response.status}`, 
        details: errorText,
        hint: hint
      }, { status: 500 });
    }

    const data = await response.json();
    const checks = data.checks || data.data || [];

    // Get existing expenses to avoid duplicates
    const existingExpenses = await base44.entities.Expense.filter({ company_id: company.id });
    const existingRefs = new Set(existingExpenses.map(e => e.reference_number).filter(Boolean));

    let imported = 0;
    let skipped = 0;
    const importedExpenses = [];

    for (const check of checks) {
      // Filter by date range
      const checkDate = new Date(check.date || check.check_date);
      if (checkDate < startDate) {
        continue;
      }

      // Skip if already imported (using check number as reference)
      const checkNumber = check.check_number || check.id;
      if (existingRefs.has(checkNumber?.toString())) {
        skipped++;
        continue;
      }

      // Create expense record
      const expenseData = {
        company_id: company.id,
        vendor_name: check.payee_name || check.payee || 'Unknown Vendor',
        amount: parseFloat(check.amount || 0),
        expense_date: check.date || check.check_date || new Date().toISOString().split('T')[0],
        category: check.category || 'Contractor/Vendor Payment',
        payment_method: 'check',
        reference_number: checkNumber?.toString(),
        description: check.memo || check.description || check.note || '',
        status: check.status === 'cleared' || check.status === 'paid' ? 'paid' : 'pending',
        notes: `Imported from Online Check Writer - Memo: ${check.memo || 'N/A'}`
      };

      const expense = await base44.entities.Expense.create(expenseData);
      importedExpenses.push(expense);
      imported++;
    }

    return Response.json({
      success: true,
      imported,
      skipped,
      total: checks.length,
      expenses: importedExpenses
    });

  } catch (error) {
    console.error('Error syncing Online Check Writer:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});