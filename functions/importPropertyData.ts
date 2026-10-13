import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cleanPhone = (v: unknown): string | undefined => {
  if (!v) return undefined;
  const cleaned = String(v).replace(/\D/g, '');
  return cleaned.length >= 7 ? cleaned : undefined;
};

const normalize = (v: unknown): string =>
  v ? String(v).toLowerCase().trim().replace(/\s+/g, ' ') : '';

// Server-side address key (mirrors client src/utils/addressSanitizer.js)
const normalizeAddressKey = (raw: unknown): string => {
  if (!raw) return '';
  const EXPAND: Record<string, string> = {
    st:'street', rd:'road', ave:'avenue', blvd:'boulevard', dr:'drive',
    ln:'lane', ct:'court', pl:'place', hwy:'highway', pkwy:'parkway', cir:'circle',
  };
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/\b(suite|ste|unit|apt|apartment|floor|fl|room|rm|#)\s*[\w\d-]*/g, '');
  s = s.replace(/[.,#\-]/g, ' ');
  return s.split(/\s+/).filter(Boolean)
    .map(t => /\d/.test(t) ? t : (EXPAND[t] || t))
    .join(' ').trim();
};

const estimateJobValue = (rawValue: unknown): number => {
  const v = parseFloat(String(rawValue ?? '').replace(/[^0-9.]/g, '')) || 0;
  if (v > 0) return Math.min(v * 0.05, 25_000);
  return 8_000;
};

/** Parse a raw CSV string into row objects (legacy path). */
function parseRawCSV(csvData: string) {
  const lines = csvData.trim().split('\n');
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) { const i = headers.findIndex(h => h.includes(n)); if (i !== -1) return i; }
    return -1;
  };
  const ownerIdx  = col(['owner','name','property owner']);
  const addrIdx   = col(['address','property address','street addr','site addr']);
  const cityIdx   = col(['city','municipality']);
  const stateIdx  = col(['state']);
  const zipIdx    = col(['zip','postal','zipcode','zip code']);
  const phoneIdx  = col(['phone','telephone','contact']);
  const emailIdx  = col(['email','e-mail']);
  const valueIdx  = col(['value','property value','assessed value','appraised']);

  if (ownerIdx === -1 || addrIdx === -1) {
    return { error: 'CSV must have "Owner Name" and "Address" columns', headers };
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    const name = cells[ownerIdx] || '';
    const address = cells[addrIdx] || '';
    if (!name && !address) continue;
    rows.push({
      name, address,
      city:  cityIdx  !== -1 ? cells[cityIdx]  || '' : '',
      state: stateIdx !== -1 ? cells[stateIdx] || '' : '',
      zip:   zipIdx   !== -1 ? cells[zipIdx]   || '' : '',
      phone: phoneIdx !== -1 ? cells[phoneIdx] || '' : '',
      email: emailIdx !== -1 ? cells[emailIdx] || '' : '',
      value: valueIdx !== -1 ? cells[valueIdx] || '' : '',
    });
  }
  return { rows };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user   = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      csvData,           // legacy raw CSV string
      cleanedRows,       // new: pre-sanitized rows from client pipeline
      stormContext,
      sanitizationSummary, // client-side summary to echo back in response
      dryRun = false,    // when true, check DB dupes but skip insert (preview mode)
    } = body;

    // ── Resolve input rows ──────────────────────────────────────────────────
    let rows: Record<string, string>[];

    if (Array.isArray(cleanedRows) && cleanedRows.length > 0) {
      // Client already ran the full sanitization pipeline
      rows = cleanedRows;
    } else if (csvData) {
      const parsed = parseRawCSV(csvData);
      if (!parsed) return Response.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
      if ('error' in parsed) return Response.json(parsed, { status: 400 });
      rows = parsed.rows!;
    } else {
      return Response.json({ error: 'csvData or cleanedRows is required' }, { status: 400 });
    }

    // ── Fetch existing leads for cross-DB dedup ─────────────────────────────
    console.log(`[importPropertyData] ${rows.length} rows to process; fetching existing leads…`);
    let existingLeads: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const batch = await base44.entities.Lead.list('-created_date', 1000);
      existingLeads = [...existingLeads, ...batch];
      if (batch.length < 1000) break;
      offset += 1000;
    }
    console.log(`[importPropertyData] ${existingLeads.length} existing leads loaded for dedup`);

    const existingAddresses = new Set(
      existingLeads.map(l => normalizeAddressKey(normalize(l.company as string)))
    );
    const existingPhones = new Set(
      existingLeads.map(l => cleanPhone(l.phone as string)).filter(Boolean) as string[]
    );
    const existingEmails = new Set(
      existingLeads.filter(l => l.email).map(l => normalize(l.email as string))
    );

    let created = 0, dbDuplicates = 0, errors = 0;
    const dbDupeExamples: string[] = [];

    for (const row of rows) {
      try {
        const city  = row.city  || '';
        const state = row.state || 'OH';
        const zip   = row.zip   || '';
        const statePart = state && zip ? `${state} ${zip}` : (state || zip);
        const fullAddress = [row.address, city, statePart].filter(Boolean).join(', ');
        const addrKey = normalizeAddressKey(fullAddress);
        const phone   = cleanPhone(row.phone);
        const email   = normalize(row.email);

        // Cross-DB duplicate check
        let isDupe = false;
        if (addrKey && existingAddresses.has(addrKey)) {
          isDupe = true;
          if (dbDupeExamples.length < 5) dbDupeExamples.push(fullAddress);
        } else if (phone && existingPhones.has(phone)) {
          isDupe = true;
        } else if (email && existingEmails.has(email)) {
          isDupe = true;
        }

        if (isDupe) { dbDuplicates++; continue; }

        if (!dryRun) {
          await base44.asServiceRole.entities.Lead.create({
            name:        row.name,
            company:     fullAddress,
            email:       email || undefined,
            phone,
            status:      'new',
            source:      'property_importer',
            lead_source: stormContext || 'Property Data Import',
            value:       estimateJobValue(row.value),
            is_active:   true,
            notes: [
              stormContext ? `Source: ${stormContext}` : '',
              `Property: ${fullAddress}`,
              Number(row.value) > 0 ? `Property Value: $${Number(row.value).toLocaleString()}` : '',
              'Imported from county property records',
            ].filter(Boolean).join('\n'),
          });

          // Update in-memory dedup sets so later rows in same batch see new entries
          existingAddresses.add(addrKey);
          if (phone) existingPhones.add(phone);
          if (email) existingEmails.add(email);
        }

        created++;
      } catch (err) {
        console.error('[importPropertyData] row error:', err);
        errors++;
      }
    }

    return Response.json({
      success:              true,
      leadsCreated:         dryRun ? 0 : created,
      dbDuplicatesSkipped:  dbDuplicates,
      wouldCreate:          dryRun ? created : undefined,
      errors,
      totalCleaned:         rows.length,
      dryRun,
      existingLeadsChecked: existingLeads.length,
      dbDupeExamples,
      // Echo the client-side summary so the UI can display the full picture
      clientSanitizationSummary: sanitizationSummary ?? null,
    });

  } catch (error) {
    console.error('[importPropertyData] error:', error);
    return Response.json({ error: (error as Error).message, success: false }, { status: 500 });
  }
});
