import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  console.log('📋 Material List Generator - Request received');
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('❌ Unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ User authenticated:', user.email);

    let body;
    try {
      body = await req.json();
      console.log('📦 Request body parsed successfully');
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError);
      return Response.json({ 
        error: 'Invalid request format',
        details: parseError.message 
      }, { status: 400 });
    }

    const { estimateId, estimate } = body;
    console.log('📊 Processing estimate:', { estimateId, hasEstimateObject: !!estimate });

    let estimateData;

    if (estimateId) {
      console.log('🔍 Fetching estimate from database:', estimateId);
      const estimates = await base44.entities.Estimate.filter({ id: estimateId });
      estimateData = estimates[0];
      
      if (!estimateData) {
        console.error('❌ Estimate not found:', estimateId);
        return Response.json({ error: 'Estimate not found' }, { status: 404 });
      }
      console.log('✅ Estimate loaded from database');
    } else if (estimate) {
      console.log('✅ Using provided estimate object');
      estimateData = estimate;
    } else {
      console.error('❌ No estimate provided');
      return Response.json({ error: 'Either estimateId or estimate is required' }, { status: 400 });
    }

    // Normalize items defensively to avoid crashes on mobile/edge cases
    const rawItems = Array.isArray(estimateData.line_items) ? estimateData.line_items
                  : Array.isArray(estimateData.items) ? estimateData.items
                  : [];

    const items = rawItems
      .filter(Boolean)
      .map((it) => ({
        ...it,
        description: (it?.description ?? '').toString(),
        code: (it?.code ?? '').toString(),
        unit: (it?.unit ?? '').toString(),
        quantity: Number(it?.quantity) || 0,
        rate: Number(it?.rate) || Number(it?.price) || 0,
        rcv: Number(it?.rcv) || Number(it?.amount) || 0,
        amount: Number(it?.amount) || Number(it?.rcv) || 0,
      }));

    console.log(`📋 Processing ${items.length} line items (normalized)`);

    if (!items || items.length === 0) {
      console.error('❌ No items in estimate');
      return Response.json({ error: 'No items found in estimate' }, { status: 400 });
    }

    // Categorize items
    const materials = [];
    const labor = [];
    const other = [];

    items.forEach((item, idx) => {
      const desc = (item.description || '').toLowerCase();
      const code = (item.code || '').toLowerCase();

      // LABOR: Removal, tear-off, disposal
      if (code.includes('r&r') || code.includes('rem') || 
          desc.includes('remove') || desc.includes('tear off') || 
          desc.includes('disposal') || desc.includes('debris')) {
        labor.push(item);
      } 
      // MATERIALS: Roofing materials
      else if (desc.includes('shingle') || desc.includes('underlayment') || 
               desc.includes('felt') || desc.includes('ice') || desc.includes('water') ||
               desc.includes('drip edge') || desc.includes('starter') || 
               desc.includes('ridge') || desc.includes('hip') || desc.includes('valley') ||
               desc.includes('flashing') || desc.includes('nail') || desc.includes('vent')) {
        materials.push(item);
      }
      // MATERIALS: Siding materials
      else if (desc.includes('siding') || desc.includes('j-channel') || desc.includes('j channel') ||
               desc.includes('corner') || desc.includes('soffit') || desc.includes('fascia') ||
               desc.includes('house wrap') || desc.includes('housewrap') || desc.includes('tyvek') ||
               desc.includes('fan fold') || desc.includes('fanfold')) {
        materials.push(item);
      }
      // OTHER: Everything else (O&P, surcharges, etc.)
      else {
        other.push(item);
      }
    });

    console.log(`✅ Categorized: ${materials.length} materials, ${labor.length} labor, ${other.length} other`);

    // FIXED: Calculate material quantities by SUMMING ALL matching items
    const materialCalculations = [];

    // SHINGLES - SUM ALL SHINGLE ITEMS
    const allShingles = materials.filter(m => 
      (m.description?.toLowerCase().includes('shingle') && 
       !m.description?.toLowerCase().includes('cap') &&
       !m.description?.toLowerCase().includes('starter')) &&
      m.unit?.toUpperCase() === 'SQ'
    );
    
    if (allShingles.length > 0) {
      const totalSquares = allShingles.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const bundles = Math.ceil(totalSquares * 3);
      const sections = allShingles.map(s => `${Number(s.quantity).toFixed(2)} SQ`).join(' + ');
      
      materialCalculations.push({
        material: 'Shingles',
        quantity: bundles,
        unit: 'bundles',
        purchaseUnit: 'bundles',
        calculation: `${sections} = ${totalSquares.toFixed(2)} SQ × 3 = ${bundles} bundles`,
        notes: 'Each bundle covers ~33 sq ft.'
      });
      
      console.log(`✅ Shingles: Found ${allShingles.length} items, total ${totalSquares.toFixed(2)} SQ = ${bundles} bundles`);
    }

    // UNDERLAYMENT - SUM ALL UNDERLAYMENT ITEMS
    const allUnderlayment = materials.filter(m => 
      (m.description?.toLowerCase().includes('underlayment') || 
       m.description?.toLowerCase().includes('felt') ||
       m.description?.toLowerCase().includes('synthetic')) &&
      m.unit?.toUpperCase() === 'SQ'
    );
    
    if (allUnderlayment.length > 0) {
      const totalSquares = allUnderlayment.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const rolls = Math.ceil(totalSquares / 10);
      const sections = allUnderlayment.map(u => `${Number(u.quantity).toFixed(2)} SQ`).join(' + ');
      
      materialCalculations.push({
        material: 'Underlayment',
        quantity: rolls,
        unit: 'rolls',
        purchaseUnit: 'rolls',
        calculation: `${sections} = ${totalSquares.toFixed(2)} SQ ÷ 10 = ${rolls} rolls`,
        notes: 'Synthetic felt roll covers 10 SQ (1,000 sq ft).'
      });
      
      console.log(`✅ Underlayment: Found ${allUnderlayment.length} items, total ${totalSquares.toFixed(2)} SQ = ${rolls} rolls`);
    }

    // ICE & WATER SHIELD - SUM ALL
    const allIceWater = materials.filter(m => 
      ((m.description?.toLowerCase().includes('ice') && m.description?.toLowerCase().includes('water')) ||
      m.code?.toUpperCase().includes('IWS')) &&
      (m.unit?.toUpperCase() === 'LF' || m.unit?.toUpperCase() === 'SF')
    );
    
    if (allIceWater.length > 0) {
      let totalLF = 0;
      
      allIceWater.forEach(item => {
        const qty = Number(item.quantity) || 0;
        if (item.unit?.toUpperCase() === 'SF') {
          totalLF += qty / 3;
        } else {
          totalLF += qty;
        }
      });
      
      const rolls = Math.ceil(totalLF / 50);
      
      materialCalculations.push({
        material: 'Ice & Water Shield',
        quantity: rolls,
        unit: 'rolls',
        purchaseUnit: 'rolls',
        calculation: `${totalLF.toFixed(2)} LF ÷ 50 = ${rolls} rolls`,
        notes: 'Each roll covers 50 LF (150 sq ft @ 3 ft wide).'
      });
      
      console.log(`✅ Ice & Water: Found ${allIceWater.length} items, total ${totalLF.toFixed(2)} LF = ${rolls} rolls`);
    }

    // RIDGE CAP - SUM ALL
    const allRidgeCap = materials.filter(m => 
      (m.description?.toLowerCase().includes('ridge') || m.description?.toLowerCase().includes('hip')) &&
      m.description?.toLowerCase().includes('cap') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allRidgeCap.length > 0) {
      const totalLF = allRidgeCap.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const bundles = Math.ceil(totalLF / 33);
      const sections = allRidgeCap.map(r => `${Number(r.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Ridge Cap',
        quantity: bundles,
        unit: 'bundles',
        purchaseUnit: 'bundles',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 33 = ${bundles} bundles`,
        notes: 'Each bundle covers ~33 LF.'
      });
      
      console.log(`✅ Ridge Cap: Found ${allRidgeCap.length} items, total ${totalLF.toFixed(2)} LF = ${bundles} bundles`);
    }

    // STARTER STRIP - SUM ALL
    const allStarter = materials.filter(m => 
      m.description?.toLowerCase().includes('starter') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allStarter.length > 0) {
      const totalLF = allStarter.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const bundles = Math.ceil(totalLF / 100);
      const sections = allStarter.map(s => `${Number(s.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Starter Strip',
        quantity: bundles,
        unit: 'bundles',
        purchaseUnit: 'bundles',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 100 = ${bundles} bundles`,
        notes: 'Each bundle covers ~100 LF.'
      });
      
      console.log(`✅ Starter: Found ${allStarter.length} items, total ${totalLF.toFixed(2)} LF = ${bundles} bundles`);
    }

    // DRIP EDGE - SUM ALL
    const allDripEdge = materials.filter(m => 
      m.description?.toLowerCase().includes('drip') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allDripEdge.length > 0) {
      const totalLF = allDripEdge.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 10);
      const sections = allDripEdge.map(d => `${Number(d.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Drip Edge',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 10 = ${pieces} pieces`,
        notes: 'Standard pieces are 10 ft long.'
      });
      
      console.log(`✅ Drip Edge: Found ${allDripEdge.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // VALLEY METAL - SUM ALL
    const allValley = materials.filter(m => 
      m.description?.toLowerCase().includes('valley') &&
      (m.description?.toLowerCase().includes('metal') || m.description?.toLowerCase().includes('flashing')) &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allValley.length > 0) {
      const totalLF = allValley.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 10);
      const sections = allValley.map(v => `${Number(v.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Valley Metal',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 10 = ${pieces} pieces`,
        notes: 'Standard pieces are 10 ft long.'
      });
      
      console.log(`✅ Valley: Found ${allValley.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // STEP FLASHING - SUM ALL
    const allStepFlashing = materials.filter(m => 
      m.description?.toLowerCase().includes('step') &&
      m.description?.toLowerCase().includes('flashing') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allStepFlashing.length > 0) {
      const totalLF = allStepFlashing.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const boxes = Math.ceil(totalLF / 50);
      const sections = allStepFlashing.map(s => `${Number(s.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Step Flashing',
        quantity: boxes,
        unit: 'boxes',
        purchaseUnit: 'boxes',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 50 = ${boxes} boxes`,
        notes: 'Each box contains ~100 pieces (covers ~50 LF).'
      });
      
      console.log(`✅ Step Flashing: Found ${allStepFlashing.length} items, total ${totalLF.toFixed(2)} LF = ${boxes} boxes`);
    }

    // NAILS - Based on TOTAL shingles
    if (allShingles && allShingles.length > 0) {
      const totalSquares = allShingles.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const boxes = Math.ceil(totalSquares / 15);
      
      materialCalculations.push({
        material: 'Roofing Nails',
        quantity: boxes,
        unit: 'boxes',
        purchaseUnit: 'boxes',
        calculation: `${totalSquares.toFixed(2)} SQ ÷ 15 = ${boxes} boxes`,
        notes: 'For pneumatic nailers. Each box covers ~15 SQ.'
      });
      
      console.log(`✅ Nails: Total ${totalSquares.toFixed(2)} SQ = ${boxes} boxes`);
    }

    // === SIDING MATERIALS ===
    
    // VINYL SIDING - SUM ALL SIDING ITEMS
    const allSiding = materials.filter(m => 
      m.description?.toLowerCase().includes('siding') &&
      !m.description?.toLowerCase().includes('remove') &&
      !m.description?.toLowerCase().includes('nail') &&
      m.unit?.toUpperCase() === 'SQ'
    );
    
    if (allSiding.length > 0) {
      const totalSquares = allSiding.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const boxes = Math.ceil(totalSquares / 2); // Each box covers 2 squares
      const sections = allSiding.map(s => `${Number(s.quantity).toFixed(2)} SQ`).join(' + ');
      
      materialCalculations.push({
        material: 'Vinyl Siding',
        quantity: boxes,
        unit: 'boxes',
        purchaseUnit: 'boxes',
        calculation: `${sections} = ${totalSquares.toFixed(2)} SQ ÷ 2 = ${boxes} boxes`,
        notes: 'Each box covers 2 SQ (200 sq ft). Standard D4 or D5 profile.'
      });
      
      console.log(`✅ Siding: Found ${allSiding.length} items, total ${totalSquares.toFixed(2)} SQ = ${boxes} boxes`);
    }

    // J-CHANNEL - SUM ALL J-CHANNEL ITEMS
    const allJChannel = materials.filter(m => 
      (m.description?.toLowerCase().includes('j-channel') || 
       m.description?.toLowerCase().includes('j channel')) &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allJChannel.length > 0) {
      const totalLF = allJChannel.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 12.5); // Sold in 12.5 ft pieces
      const sections = allJChannel.map(j => `${Number(j.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'J-Channel',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 12.5 = ${pieces} pieces`,
        notes: 'Standard pieces are 12.5 ft long.'
      });
      
      console.log(`✅ J-Channel: Found ${allJChannel.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // INSIDE CORNERS - SUM ALL
    const allInsideCorners = materials.filter(m => 
      m.description?.toLowerCase().includes('inside') &&
      m.description?.toLowerCase().includes('corner') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allInsideCorners.length > 0) {
      const totalLF = allInsideCorners.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 10); // 10 ft pieces standard
      const sections = allInsideCorners.map(c => `${Number(c.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Inside Corners',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 10 = ${pieces} pieces`,
        notes: 'Standard pieces are 10 ft long.'
      });
      
      console.log(`✅ Inside Corners: Found ${allInsideCorners.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // OUTSIDE CORNERS - SUM ALL
    const allOutsideCorners = materials.filter(m => 
      m.description?.toLowerCase().includes('outside') &&
      m.description?.toLowerCase().includes('corner') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allOutsideCorners.length > 0) {
      const totalLF = allOutsideCorners.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 10); // 10 ft pieces standard
      const sections = allOutsideCorners.map(c => `${Number(c.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Outside Corners',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 10 = ${pieces} pieces`,
        notes: 'Standard pieces are 10 ft long.'
      });
      
      console.log(`✅ Outside Corners: Found ${allOutsideCorners.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // HOUSE WRAP - Based on TOTAL wall area
    if (allSiding.length > 0) {
      const totalSquares = allSiding.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const totalSqFt = totalSquares * 100;
      const rolls = Math.ceil(totalSqFt / 1350); // Standard roll is 9'x150' = 1350 sq ft
      
      materialCalculations.push({
        material: 'House Wrap (Tyvek)',
        quantity: rolls,
        unit: 'rolls',
        purchaseUnit: 'rolls',
        calculation: `${totalSquares.toFixed(2)} SQ × 100 = ${totalSqFt} sq ft ÷ 1350 = ${rolls} rolls`,
        notes: 'Standard roll: 9 ft × 150 ft = 1,350 sq ft.'
      });
      
      console.log(`✅ House Wrap: Total ${totalSqFt} sq ft = ${rolls} rolls`);
    }

    // FAN FOLD - Based on TOTAL wall area (optional insulation/underlayment)
    if (allSiding.length > 0) {
      const totalSquares = allSiding.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const totalSqFt = totalSquares * 100;
      const rolls = Math.ceil(totalSqFt / 250); // Fan fold typically covers 250 sq ft per roll
      
      materialCalculations.push({
        material: 'Fan Fold (Optional)',
        quantity: rolls,
        unit: 'rolls',
        purchaseUnit: 'rolls',
        calculation: `${totalSquares.toFixed(2)} SQ × 100 = ${totalSqFt} sq ft ÷ 250 = ${rolls} rolls`,
        notes: 'Optional insulation underlayment. Each roll covers ~250 sq ft.'
      });
      
      console.log(`✅ Fan Fold: Total ${totalSqFt} sq ft = ${rolls} rolls`);
    }

    // SIDING NAILS - Based on total siding squares (5 lb pails)
    if (allSiding.length > 0) {
      const totalSquares = allSiding.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pounds = totalSquares * 1.5; // ~1.5 lbs per square
      const pails = Math.ceil(pounds / 5); // 5 lb pails
      
      materialCalculations.push({
        material: 'Siding Nails (Aluminum)',
        quantity: pails,
        unit: '5 lb pails',
        purchaseUnit: '5 lb pails',
        calculation: `${totalSquares.toFixed(2)} SQ × 1.5 = ${pounds.toFixed(0)} lbs ÷ 5 = ${pails} pails`,
        notes: 'Aluminum nails for vinyl siding. ~1.5 lbs per SQ. 5 lb pails.'
      });
      
      console.log(`✅ Siding Nails: Total ${totalSquares.toFixed(2)} SQ = ${pounds.toFixed(0)} lbs = ${pails} pails`);
    }

    // SOFFIT - SUM ALL SOFFIT ITEMS
    const allSoffit = materials.filter(m => 
      m.description?.toLowerCase().includes('soffit') &&
      !m.description?.toLowerCase().includes('remove') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allSoffit.length > 0) {
      const totalLF = allSoffit.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 12); // Standard 12 ft lengths
      const sections = allSoffit.map(s => `${Number(s.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Soffit Panels',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 12 = ${pieces} pieces`,
        notes: 'Standard vented or solid soffit panels, 12 ft × 12" wide.'
      });
      
      console.log(`✅ Soffit: Found ${allSoffit.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // FASCIA - SUM ALL FASCIA ITEMS
    const allFascia = materials.filter(m => 
      m.description?.toLowerCase().includes('fascia') &&
      !m.description?.toLowerCase().includes('remove') &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allFascia.length > 0) {
      const totalLF = allFascia.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const pieces = Math.ceil(totalLF / 12); // Standard 12 ft lengths
      const sections = allFascia.map(f => `${Number(f.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Fascia Boards',
        quantity: pieces,
        unit: 'pieces',
        purchaseUnit: 'pieces',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 12 = ${pieces} pieces`,
        notes: 'Aluminum fascia covers, 12 ft lengths. Common widths: 6", 8", 10".'
      });
      
      console.log(`✅ Fascia: Found ${allFascia.length} items, total ${totalLF.toFixed(2)} LF = ${pieces} pieces`);
    }

    // WINDOW WRAP / TRIM - Detect window-related items
    const allWindowWrap = materials.filter(m => 
      (m.description?.toLowerCase().includes('window') && 
       (m.description?.toLowerCase().includes('wrap') || 
        m.description?.toLowerCase().includes('trim') ||
        m.description?.toLowerCase().includes('capping'))) &&
      m.unit?.toUpperCase() === 'LF'
    );
    
    if (allWindowWrap.length > 0) {
      const totalLF = allWindowWrap.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const coils = Math.ceil(totalLF / 50); // Coil stock 50 ft per roll
      const sections = allWindowWrap.map(w => `${Number(w.quantity).toFixed(2)} LF`).join(' + ');
      
      materialCalculations.push({
        material: 'Window Wrap Coil',
        quantity: coils,
        unit: 'rolls',
        purchaseUnit: 'rolls',
        calculation: `${sections} = ${totalLF.toFixed(2)} LF ÷ 50 = ${coils} rolls`,
        notes: 'Aluminum coil stock for window/door trim. 50 ft per roll.'
      });
      
      console.log(`✅ Window Wrap: Found ${allWindowWrap.length} items, total ${totalLF.toFixed(2)} LF = ${coils} rolls`);
    }

    // COIL STOCK / TRIM COIL - Based on total J-channel and corners
    const trimLF = (allJChannel.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0) +
                   (allInsideCorners.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0) +
                   (allOutsideCorners.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0);
    
    if (trimLF > 0) {
      const coils = Math.ceil(trimLF / 50); // Coil stock typically 50 ft per roll
      
      materialCalculations.push({
        material: 'Trim Coil Stock',
        quantity: coils,
        unit: 'rolls',
        purchaseUnit: 'rolls',
        calculation: `${trimLF.toFixed(2)} total trim LF ÷ 50 = ${coils} rolls`,
        notes: 'Aluminum coil stock for custom trim. 50 ft per roll, 24" wide.'
      });
      
      console.log(`✅ Trim Coil: Total ${trimLF.toFixed(2)} LF = ${coils} rolls`);
    }

    console.log(`📦 Created ${materialCalculations.length} material calculations`);

    // Calculate totals
    const totals = {
      materials: materials.reduce((sum, item) => sum + (Number(item.rcv) || Number(item.amount) || 0), 0),
      labor: labor.reduce((sum, item) => sum + (Number(item.rcv) || Number(item.amount) || 0), 0),
      other: other.reduce((sum, item) => sum + (Number(item.rcv) || Number(item.amount) || 0), 0)
    };
    totals.grand_total = totals.materials + totals.labor + totals.other;

    console.log('💰 Totals calculated:', totals);
    console.log('✅ Material list generation complete');

    return Response.json({
      success: true,
      estimate: {
        estimate_number: estimateData.estimate_number || 'DRAFT',
        customer_name: estimateData.customer_name || '',
        property_address: estimateData.property_address || ''
      },
      material_calculations: materialCalculations,
      materials: materials,
      labor: labor,
      other: other,
      totals: totals
    });

  } catch (error) {
    console.error('❌ Material list generation error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});