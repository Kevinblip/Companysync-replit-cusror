import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔗 Starting FAST estimate linking...');

    // Process only 100 at a time to avoid timeout
    const estimates = await base44.entities.Estimate.list('-created_date', 100);
    const customers = await base44.entities.Customer.list('-created_date', 1000);

    console.log(`Processing ${estimates.length} estimates with ${customers.length} customers`);

    // Enhanced normalize - removes parentheses, "and", all punctuation
    const normalize = (str) => {
      return str.toLowerCase()
        .replace(/\(.*?\)/g, '') // Remove parentheses and content
        .replace(/\band\b/gi, '') // Remove "and"
        .replace(/[^a-z0-9\s]/g, '') // Remove all punctuation
        .replace(/\s+/g, ' ')
        .trim();
    };

    const customerMap = new Map();
    
    customers.forEach(customer => {
      if (!customer.name) return;
      
      const name = customer.name.trim();
      const normalized = normalize(name);
      
      // Store by normalized name
      customerMap.set(normalized, customer);
      
      // Store by company name if different
      if (customer.company && customer.company.trim() !== name) {
        customerMap.set(normalize(customer.company), customer);
      }
      
      // Handle "LAST, FIRST" format
      if (name.includes(',')) {
        const parts = name.split(',').map(p => p.trim());
        if (parts.length === 2 && parts[0] && parts[1]) {
          const reversed = `${parts[1]} ${parts[0]}`;
          customerMap.set(normalize(reversed), customer);
        }
      }
      
      // Handle "First Last" -> "Last First" reversal
      if (!name.includes(',') && name.includes(' ')) {
        const parts = name.split(' ').filter(p => p);
        if (parts.length === 2) {
          const reversed = `${parts[1]} ${parts[0]}`;
          customerMap.set(normalize(reversed), customer);
        }
      }
    });

    let linked = 0;
    let skipped = 0;
    let notFound = [];

    // Batch updates to avoid rate limiting
    const updates = [];

    for (const estimate of estimates) {
      if (!estimate.customer_name || !estimate.customer_name.trim() || estimate.customer_id) {
        skipped++;
        continue;
      }

      const estimateName = estimate.customer_name.trim();
      let matchedCustomer = customerMap.get(normalize(estimateName));
      
      // Fast fuzzy match
      if (!matchedCustomer) {
        const words = normalize(estimateName).split(' ').filter(w => w.length > 1);
        
        for (const [key, customer] of customerMap.entries()) {
          const custWords = key.split(' ').filter(w => w.length > 1);
          
          if (words.length >= 2 && words.every(w => custWords.includes(w))) {
            matchedCustomer = customer;
            break;
          }
        }
      }

      if (matchedCustomer) {
        updates.push({ estimate, customer: matchedCustomer });
      } else {
        notFound.push({
          estimate_number: estimate.estimate_number,
          customer_name: estimate.customer_name
        });
        skipped++;
      }
    }

    // Process updates in batches of 5
    for (let i = 0; i < updates.length; i += 5) {
      const batch = updates.slice(i, i + 5);
      await Promise.all(batch.map(({ estimate, customer }) => 
        base44.entities.Estimate.update(estimate.id, { customer_id: customer.id })
      ));
      linked += batch.length;
      console.log(`✅ Linked ${linked}/${updates.length}`);
      await new Promise(r => setTimeout(r, 200));
    }

    return Response.json({
      success: true,
      linked,
      skipped,
      total: estimates.length,
      notFound: notFound.slice(0, 10),
      message: `✅ Linked ${linked}/${estimates.length} estimates (batch completed)`
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack || 'No stack trace'
    }, { status: 500 });
  }
});