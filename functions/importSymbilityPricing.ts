import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  console.log('📊 Importing Symbility Price List...');
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orgId, username, password, apiKey, soapUrl } = await req.json();

    console.log('📋 Import parameters:', {
      orgId,
      soapUrl,
      hasCredentials: !!username && !!password && !!apiKey
    });

    // Validate required fields
    if (!orgId || !username || !password || !apiKey || !soapUrl) {
      return Response.json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Validate username and password match
    if (username !== password) {
      return Response.json({
        success: false,
        error: 'Username and Password must be IDENTICAL'
      });
    }

    // Create SOAP request for price list
    const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sym="http://symbility.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <sym:getPriceList>
      <orgId>${orgId}</orgId>
      <apiKey>${apiKey}</apiKey>
    </sym:getPriceList>
  </soapenv:Body>
</soapenv:Envelope>`;

    console.log('📤 Sending SOAP getPriceList request...');

    const response = await fetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'getPriceList'
      },
      body: soapEnvelope
    });

    const responseText = await response.text();
    console.log('📥 Response status:', response.status);
    console.log('📄 Response preview:', responseText.substring(0, 300));

    if (!response.ok) {
      return Response.json({
        success: false,
        error: `SOAP request failed with status ${response.status}`,
        details: responseText.substring(0, 500)
      });
    }

    // Check for SOAP fault
    if (responseText.includes('soap:Fault') || responseText.includes('faultstring')) {
      const faultMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/);
      const faultMessage = faultMatch ? faultMatch[1] : 'Unknown SOAP error';
      
      return Response.json({
        success: false,
        error: `Symbility error: ${faultMessage}`,
        details: responseText.substring(0, 500)
      });
    }

    // Parse price list items from XML
    console.log('🔍 Parsing price list items from XML...');
    
    const itemMatches = responseText.matchAll(/<PriceListItem>(.*?)<\/PriceListItem>/gs);
    const items = [];
    
    for (const match of itemMatches) {
      const itemXml = match[1];
      
      const code = itemXml.match(/<code>(.*?)<\/code>/)?.[1] || '';
      const description = itemXml.match(/<description>(.*?)<\/description>/)?.[1] || '';
      const unit = itemXml.match(/<unit>(.*?)<\/unit>/)?.[1] || 'EA';
      const priceStr = itemXml.match(/<price>(.*?)<\/price>/)?.[1] || '0';
      const price = parseFloat(priceStr);
      
      if (description && price > 0) {
        items.push({
          code: code,
          description: description,
          unit: unit,
          price: price,
          category: 'Other',
          source: 'Symbility',
          is_active: true
        });
      }
    }

    console.log(`✅ Parsed ${items.length} price list items`);

    if (items.length === 0) {
      return Response.json({
        success: false,
        error: 'No price list items found in Symbility response. Check your Organization ID.',
        details: responseText.substring(0, 500)
      });
    }

    // Delete existing Symbility items
    console.log('🗑️ Clearing existing Symbility items...');
    const existingItems = await base44.asServiceRole.entities.PriceListItem.filter({ source: 'Symbility' });
    
    for (const item of existingItems) {
      await base44.asServiceRole.entities.PriceListItem.delete(item.id);
    }

    console.log(`Deleted ${existingItems.length} old items`);

    // Import new items in batches
    console.log('📦 Importing new items...');
    const batchSize = 50;
    let imported = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await base44.asServiceRole.entities.PriceListItem.bulkCreate(batch);
      imported += batch.length;
      console.log(`Progress: ${imported}/${items.length}`);
    }

    console.log('✅ Import complete!');

    return Response.json({
      success: true,
      imported: imported,
      message: `Successfully imported ${imported} Symbility price list items!`
    });

  } catch (error) {
    console.error('❌ Symbility import error:', error);
    return Response.json({
      success: false,
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});