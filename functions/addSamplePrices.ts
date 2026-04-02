import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the company_id from request body or find user's company
    const { company_id } = await req.json().catch(() => ({}));
    
    let targetCompanyId = company_id;
    if (!targetCompanyId) {
      // Find user's company via staff profile
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0) {
        targetCompanyId = staffProfiles[0].company_id;
      } else {
        // Fallback: find company created by user
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        if (companies.length > 0) {
          targetCompanyId = companies[0].id;
        }
      }
    }
    
    if (!targetCompanyId) {
      return Response.json({ error: 'No company found for user' }, { status: 400 });
    }

    console.log('Adding sample Xactimate prices for company:', targetCompanyId);

    const samplePrices = [
      // Roofing
      { code: 'RFG SSSQ', description: 'Shingles, 3-tab, strip', unit: 'SQ', price: 125.00, category: 'Roofing' },
      { code: 'RFG ARLM', description: 'Shingles, architectural/laminated', unit: 'SQ', price: 150.00, category: 'Roofing' },
      { code: 'RFG RDG', description: 'Ridge cap', unit: 'LF', price: 8.50, category: 'Roofing' },
      { code: 'RFG HP', description: 'Hip', unit: 'LF', price: 8.50, category: 'Roofing' },
      { code: 'RFG VLY', description: 'Valley', unit: 'LF', price: 12.00, category: 'Roofing' },
      { code: 'RFG STR', description: 'Eave/Starter strip', unit: 'LF', price: 3.50, category: 'Roofing' },
      { code: 'RFG DE', description: 'Drip edge/Rake edge', unit: 'LF', price: 4.00, category: 'Roofing' },
      { code: 'RFG UL', description: 'Underlayment, felt', unit: 'SQ', price: 15.00, category: 'Roofing' },
      { code: 'RFG IWS', description: 'Ice & Water Shield', unit: 'LF', price: 8.00, category: 'Roofing' },
      { code: 'RFG FLS', description: 'Step flashing', unit: 'LF', price: 6.50, category: 'Roofing' },
      { code: 'RFG R&R', description: 'Remove & dispose roof covering', unit: 'SQ', price: 45.00, category: 'Roofing' },
      { code: 'RFG STEEP', description: 'Steep roof charge (7/12+)', unit: 'SQ', price: 25.00, category: 'Roofing' },
      { code: 'RFG HIGH', description: 'High roof charge (2+ stories)', unit: 'SQ', price: 20.00, category: 'Roofing' },
      { code: 'DEB', description: 'Debris removal/dumpster', unit: 'EA', price: 500.00, category: 'Other' },
      
      // Siding
      { code: 'SWT-ST-ZW', description: 'Siding & Trim Only - Zero Waste', unit: 'SQ', price: 85.00, category: 'Siding' },
      { code: 'SID VNL', description: 'Vinyl siding', unit: 'SQ', price: 95.00, category: 'Siding' },
      { code: 'SID WD', description: 'Wood siding', unit: 'SQ', price: 120.00, category: 'Siding' },
    ];

    console.log(`Creating ${samplePrices.length} sample price items...`);

    for (const price of samplePrices) {
      await base44.asServiceRole.entities.PriceListItem.create({
        company_id: targetCompanyId,
        code: price.code,
        description: price.description,
        unit: price.unit,
        price: price.price,
        category: price.category,
        source: 'Xactimate'
      });
    }

    console.log('✅ Sample prices added successfully');

    return Response.json({ 
      success: true, 
      message: `Added ${samplePrices.length} sample Xactimate prices`,
      count: samplePrices.length
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});