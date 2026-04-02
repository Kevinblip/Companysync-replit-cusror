import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// Helper function to clean phone numbers
const cleanPhone = (phoneString) => {
  if (!phoneString) return undefined;
  const cleaned = phoneString.replace(/\D/g, '');
  return cleaned.length > 0 ? cleaned : undefined;
};

// Helper function to normalize text for comparison
const normalize = (text) => {
  if (!text) return '';
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
};

// Helper function to estimate job value
const estimateJobValue = (propertyValue) => {
  let estimatedValue = 8000;
  if (propertyValue > 0) {
    estimatedValue = Math.min(propertyValue * 0.05, 25000);
  }
  return estimatedValue;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { csvData, stormContext } = await req.json();

    if (!csvData) {
      return Response.json({ error: 'CSV data required' }, { status: 400 });
    }

    // Parse CSV
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      return Response.json({ error: 'CSV must have header row and at least one data row' }, { status: 400 });
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    // Find column indices
    const getColumnIndex = (possibleNames) => {
      for (const name of possibleNames) {
        const idx = headers.findIndex(h => h.includes(name));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const ownerIdx = getColumnIndex(['owner', 'name', 'property owner']);
    const addressIdx = getColumnIndex(['address', 'property address', 'street']);
    const cityIdx = getColumnIndex(['city', 'municipality']);
    const zipIdx = getColumnIndex(['zip', 'postal', 'zipcode']);
    const phoneIdx = getColumnIndex(['phone', 'telephone', 'contact']);
    const emailIdx = getColumnIndex(['email', 'e-mail']);
    const valueIdx = getColumnIndex(['value', 'property value', 'assessed value']);

    if (ownerIdx === -1 || addressIdx === -1) {
      return Response.json({ 
        error: 'CSV must have "Owner Name" and "Address" columns',
        headers: headers 
      }, { status: 400 });
    }

    // Get ALL existing leads for duplicate checking
    console.log('Fetching existing leads for duplicate detection...');
    let existingLeads = [];
    let offset = 0;
    const batchSize = 1000;
    
    // Fetch in batches to get all leads
    while (true) {
      const batch = await base44.entities.Lead.list('-created_date', batchSize);
      if (batch.length === 0) break;
      existingLeads = [...existingLeads, ...batch];
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    console.log(`Found ${existingLeads.length} existing leads`);

    // Build comprehensive duplicate detection sets
    const existingAddresses = new Set(
      existingLeads.map(l => normalize(l.company))
    );
    const existingPhones = new Set(
      existingLeads.filter(l => l.phone).map(l => cleanPhone(l.phone))
    );
    const existingEmails = new Set(
      existingLeads.filter(l => l.email).map(l => normalize(l.email))
    );
    const existingNames = new Set(
      existingLeads.map(l => normalize(l.name))
    );

    let created = 0;
    let skipped = 0;
    let errors = 0;
    const duplicateReasons = [];

    // Process each row
    for (let i = 1; i < lines.length; i++) {
      try {
        const row = lines[i].split(',').map(cell => cell.trim());
        
        const ownerName = row[ownerIdx];
        const address = row[addressIdx];
        const city = cityIdx !== -1 ? row[cityIdx] : '';
        const zip = zipIdx !== -1 ? row[zipIdx] : '';
        const phone = phoneIdx !== -1 ? row[phoneIdx] : '';
        const email = emailIdx !== -1 ? row[emailIdx] : '';
        const propertyValue = valueIdx !== -1 ? parseFloat(row[valueIdx].replace(/[^0-9.]/g, '')) : 0;

        if (!ownerName || !address) {
          errors++;
          continue;
        }

        // Comprehensive duplicate checking
        const fullAddress = `${address}, ${city}, OH ${zip}`;
        const normalizedAddress = normalize(fullAddress);
        const normalizedName = normalize(ownerName);
        const normalizedEmail = normalize(email);
        const cleanedPhone = cleanPhone(phone);

        let isDuplicate = false;
        let duplicateReason = '';

        // Check address
        if (existingAddresses.has(normalizedAddress)) {
          isDuplicate = true;
          duplicateReason = `Address: ${fullAddress}`;
        }
        
        // Check phone (if provided)
        if (!isDuplicate && cleanedPhone && existingPhones.has(cleanedPhone)) {
          isDuplicate = true;
          duplicateReason = `Phone: ${phone}`;
        }
        
        // Check email (if provided)
        if (!isDuplicate && normalizedEmail && existingEmails.has(normalizedEmail)) {
          isDuplicate = true;
          duplicateReason = `Email: ${email}`;
        }
        
        // Check name + address combination (same name, same street name)
        if (!isDuplicate && existingNames.has(normalizedName)) {
          const streetName = address.split(' ').slice(1).join(' ');
          const matchingNameLeads = existingLeads.filter(l => 
            normalize(l.name) === normalizedName && 
            normalize(l.company).includes(normalize(streetName))
          );
          if (matchingNameLeads.length > 0) {
            isDuplicate = true;
            duplicateReason = `Name + Street: ${ownerName} on ${streetName}`;
          }
        }

        if (isDuplicate) {
          skipped++;
          duplicateReasons.push(duplicateReason);
          continue;
        }

        // Create lead
        const leadData = {
          name: ownerName,
          company: fullAddress,
          email: email || undefined,
          phone: cleanedPhone,
          status: 'new',
          source: 'property_importer',
          lead_source: stormContext || "Property Data Import",
          value: estimateJobValue(propertyValue),
          is_active: true,
          notes: [
            stormContext ? `Source: ${stormContext}` : "",
            `Property: ${fullAddress}`,
            propertyValue > 0 ? `Property Value: $${propertyValue.toLocaleString()}` : "",
            "Imported from county property records"
          ].filter(Boolean).join("\n")
        };

        await base44.asServiceRole.entities.Lead.create(leadData);
        
        // Add to duplicate detection sets
        existingAddresses.add(normalizedAddress);
        if (cleanedPhone) existingPhones.add(cleanedPhone);
        if (normalizedEmail) existingEmails.add(normalizedEmail);
        existingNames.add(normalizedName);
        
        created++;

      } catch (error) {
        console.error(`Error processing row ${i}:`, error);
        errors++;
      }
    }

    return Response.json({
      success: true,
      leadsCreated: created,
      skipped: skipped,
      errors: errors,
      totalRows: lines.length - 1,
      existingLeadsChecked: existingLeads.length,
      duplicateDetails: duplicateReasons.slice(0, 10) // First 10 duplicate examples
    });

  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});