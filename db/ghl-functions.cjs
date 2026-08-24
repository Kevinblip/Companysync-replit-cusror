const ghl = require('./ghl-client.cjs');

function createGhlHandlers({ getPool, getUserFromRequest, generateEntityId }) {
  async function requireUser(req) {
    const user = req ? await getUserFromRequest(req) : null;
    if (!user?.email) {
      return { error: { success: false, error: 'Unauthorized' } };
    }
    return { user };
  }

  async function resolveAuthorizedCompanyId(pool, user, requestedCompanyId) {
    const staff = await pool.query(
      `SELECT company_id FROM staff_profiles
       WHERE (user_email = $1 OR email = $1)
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 20`,
      [user.email]
    );
    const owned = await pool.query(
      `SELECT id FROM companies WHERE created_by = $1 AND COALESCE(is_deleted, false) = false LIMIT 20`,
      [user.email]
    );
    const allowed = new Set([
      ...staff.rows.map((row) => row.company_id).filter(Boolean),
      ...owned.rows.map((row) => row.id).filter(Boolean),
      user.company_id,
    ].filter(Boolean));

    if (requestedCompanyId) {
      if (allowed.has(requestedCompanyId) || user.is_super_admin || user.platform_role === 'super_admin') {
        return requestedCompanyId;
      }
      return null;
    }
    return [...allowed][0] || null;
  }

  async function loadGhlSettings(pool, companyId) {
    const result = await pool.query(
      `SELECT id, company_id, data FROM generic_entities
       WHERE entity_type = 'IntegrationSetting' AND company_id = $1
         AND (LOWER(data->>'integration_name') = 'gohighlevel'
           OR LOWER(REPLACE(data->>'integration_name', ' ', '')) = 'gohighlevel')
       ORDER BY updated_date DESC NULLS LAST
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function credentialsForCompany(pool, companyId, settingsRow) {
    const config = ghl.extractConfig(settingsRow);
    const token = ghl.resolveApiKey(config, process.env.GHL_API_KEY, process.env.ENCRYPTION_KEY);
    const locationId = config.location_id || settingsRow?.data?.location_id || '';
    return { token, locationId, config, settingsRow };
  }

  async function ghlFetch(url, { token, method = 'GET', body } = {}) {
    const resp = await fetch(url, {
      method,
      headers: ghl.ghlHeaders(token),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: resp.ok, status: resp.status, json, text };
  }

  async function verifyConnection(token, locationId) {
    if (!token) return { ok: false, error: 'API / private integration token is required' };
    if (!locationId) return { ok: false, error: 'Location ID is required' };

    const location = await ghlFetch(ghl.buildLocationUrl(locationId), { token });
    if (location.ok) {
      const loc = location.json?.location || location.json || {};
      return { ok: true, location_name: loc.name || loc.businessName || loc.companyName || null };
    }

    const contacts = await ghlFetch(ghl.buildListContactsUrl({ locationId, limit: 1 }), { token });
    if (contacts.ok) {
      return { ok: true, location_name: null };
    }

    const detail = location.text || contacts.text || `HTTP ${contacts.status}`;
    if (location.status === 401 || contacts.status === 401) {
      return { ok: false, error: 'GoHighLevel rejected the token. Check the Private Integration token and scopes (contacts + locations).' };
    }
    if (location.status === 404) {
      return { ok: false, error: 'Location ID was not found for this token. Copy the Location ID from GHL Settings → Business Profile.' };
    }
    return { ok: false, error: `GoHighLevel connection failed (${location.status || contacts.status}): ${detail.slice(0, 300)}` };
  }

  async function upsertLocalLead(pool, companyId, contact, ownerEmail) {
    const payload = ghl.contactToLead(contact, companyId, ownerEmail);
    const phoneDigits = ghl.normalizePhoneDigits(payload.phone);
    const existing = await pool.query(
      `SELECT id, ghl_contact_id, email, phone, notes FROM leads
       WHERE company_id = $1
         AND (
           ($2::text IS NOT NULL AND ghl_contact_id = $2)
           OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3))
           OR ($4::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $4)
         )
       LIMIT 1`,
      [companyId, payload.ghl_contact_id, payload.email, phoneDigits]
    );

    if (existing.rows[0]) {
      await pool.query(
        `UPDATE leads SET
           name = COALESCE(NULLIF($1, ''), name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           street = COALESCE($4, street),
           city = COALESCE($5, city),
           state = COALESCE($6, state),
           zip = COALESCE($7, zip),
           address = COALESCE($8, address),
           company = COALESCE($9, company),
           ghl_contact_id = COALESCE($10, ghl_contact_id),
           source = COALESCE(source, 'gohighlevel'),
           lead_source = COALESCE(lead_source, 'GoHighLevel'),
           updated_at = NOW()
         WHERE id = $11`,
        [
          payload.name, payload.email, payload.phone, payload.street, payload.city,
          payload.state, payload.zip, payload.address, payload.company,
          payload.ghl_contact_id, existing.rows[0].id,
        ]
      );
      return { action: 'updated', id: existing.rows[0].id, preview: payload };
    }

    const newId = generateEntityId('lead');
    await pool.query(
      `INSERT INTO leads (
         id, company_id, name, email, phone, street, city, state, zip, address,
         company, status, source, lead_source, ghl_contact_id, notes, assigned_to,
         is_active, created_by, tags, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, 'new', 'gohighlevel', 'GoHighLevel', $12, $13, $14,
         true, $15, $16::jsonb, NOW(), NOW()
       )`,
      [
        newId, companyId, payload.name, payload.email, payload.phone, payload.street,
        payload.city, payload.state, payload.zip, payload.address, payload.company,
        payload.ghl_contact_id, payload.notes, payload.assigned_to, ownerEmail,
        JSON.stringify(payload.tags || []),
      ]
    );
    return { action: 'created', id: newId, preview: payload };
  }

  async function importContacts({ pool, token, locationId, companyId, ownerEmail, maxPages = ghl.GHL_MAX_IMPORT_PAGES, maxContacts = null }) {
    let created = 0;
    let updated = 0;
    let startAfterId = null;
    let pages = 0;
    let total = 0;
    const errors = [];

    while (pages < maxPages) {
      const listed = await ghlFetch(ghl.buildListContactsUrl({ locationId, limit: ghl.GHL_PAGE_LIMIT, startAfterId }), { token });
      if (!listed.ok) {
        throw new Error(`GHL contacts list failed (${listed.status}): ${(listed.text || '').slice(0, 300)}`);
      }
      const page = ghl.parseContactsPage(listed.json || {});
      if (!page.contacts.length) break;

      for (const contact of page.contacts) {
        if (maxContacts != null && total >= maxContacts) {
          return { created, updated, total, pages, errors };
        }
        try {
          const result = await upsertLocalLead(pool, companyId, contact, ownerEmail);
          if (result.action === 'created') created += 1;
          else updated += 1;
          total += 1;
        } catch (err) {
          errors.push({ contactId: contact?.id, error: err.message });
        }
      }

      pages += 1;
      if (!page.hasMore) break;
      startAfterId = page.nextStartAfterId;
      if (!startAfterId && page.nextPageUrl) {
        const next = await ghlFetch(page.nextPageUrl, { token });
        if (!next.ok) break;
        const nextPage = ghl.parseContactsPage(next.json || {});
        for (const contact of nextPage.contacts) {
          if (maxContacts != null && total >= maxContacts) break;
          try {
            const result = await upsertLocalLead(pool, companyId, contact, ownerEmail);
            if (result.action === 'created') created += 1;
            else updated += 1;
            total += 1;
          } catch (err) {
            errors.push({ contactId: contact?.id, error: err.message });
          }
        }
        break;
      }
      if (!startAfterId) break;
    }

    return { created, updated, total, pages, errors };
  }

  async function pushLeadToGhl(pool, lead, token, locationId) {
    const body = ghl.leadToGhlContact(lead, locationId);
    if (!body.email && !body.phone) {
      return { success: false, skipped: true, error: 'Lead needs an email or phone to sync to GoHighLevel' };
    }

    const upsert = await ghlFetch(ghl.buildUpsertContactUrl(), { token, method: 'POST', body });
    if (!upsert.ok) {
      return { success: false, error: `GHL upsert failed (${upsert.status}): ${(upsert.text || '').slice(0, 300)}` };
    }
    const ghlId = upsert.json?.contact?.id || upsert.json?.id;
    if (!ghlId) {
      return { success: false, error: 'GoHighLevel did not return a contact id' };
    }
    await pool.query(
      `UPDATE leads SET ghl_contact_id = $1, updated_at = NOW() WHERE id = $2`,
      [ghlId, lead.id]
    );
    return { success: true, ghlContactId: ghlId };
  }

  async function exportUnsyncedLeads(pool, companyId, token, locationId) {
    const unsynced = await pool.query(
      `SELECT id, name, email, phone, street, city, state, zip, address, company, source, lead_source, tags, ghl_contact_id
       FROM leads
       WHERE company_id = $1
         AND COALESCE(is_active, true) = true
         AND (ghl_contact_id IS NULL OR ghl_contact_id = '')
         AND (COALESCE(email, '') <> '' OR COALESCE(phone, '') <> '')
       ORDER BY created_at DESC
       LIMIT ${ghl.GHL_MAX_PUSH_LEADS}`,
      [companyId]
    );

    let pushed = 0;
    let skipped = 0;
    const errors = [];
    for (const lead of unsynced.rows) {
      const result = await pushLeadToGhl(pool, lead, token, locationId);
      if (result.success) pushed += 1;
      else if (result.skipped) skipped += 1;
      else errors.push({ leadId: lead.id, error: result.error });
    }
    return { pushed, skipped, errors, considered: unsynced.rows.length };
  }

  async function persistSyncResult(pool, settingsRow, companyId, patch) {
    const current = settingsRow?.data || {
      integration_name: ghl.GHL_INTEGRATION_NAME,
      is_enabled: true,
      config: {},
    };
    const config = { ...(current.config || {}), ...patch };
    const next = { ...current, integration_name: ghl.GHL_INTEGRATION_NAME, config };

    if (settingsRow?.id) {
      await pool.query(
        `UPDATE generic_entities SET data = $1::jsonb, updated_date = NOW() WHERE id = $2`,
        [JSON.stringify(next), settingsRow.id]
      );
      return;
    }

    const newId = generateEntityId('ghlset');
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'IntegrationSetting', $2, $3::jsonb, NOW(), NOW())`,
      [newId, companyId, JSON.stringify(next)]
    );
  }

  async function getGHLStatus(params = {}, _apiKey, req) {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const pool = getPool();
    const companyId = await resolveAuthorizedCompanyId(pool, auth.user, params.company_id);
    if (!companyId) return { success: false, error: 'Company not found for this user' };

    const settingsRow = await loadGhlSettings(pool, companyId);
    const status = ghl.publicStatusFromSettings(settingsRow, {
      envFallbackConfigured: Boolean(process.env.GHL_API_KEY),
    });
    return { success: true, company_id: companyId, ...status };
  }

  async function saveGHLSettings(params = {}, _apiKey, req) {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const pool = getPool();
    const companyId = await resolveAuthorizedCompanyId(pool, auth.user, params.company_id);
    if (!companyId) return { success: false, error: 'Company not found for this user' };

    const locationId = String(params.location_id || params.locationId || '').trim();
    const incomingKey = String(params.api_key || params.apiKey || params.token || '').trim();
    const settingsRow = await loadGhlSettings(pool, companyId);
    const currentConfig = ghl.extractConfig(settingsRow);
    const existingToken = ghl.resolveApiKey(currentConfig, process.env.GHL_API_KEY, process.env.ENCRYPTION_KEY);
    const token = incomingKey || existingToken;

    if (!locationId) return { success: false, error: 'Location ID is required' };
    if (!token) return { success: false, error: 'Paste a GoHighLevel Private Integration token (or set GHL_API_KEY).' };

    const verified = await verifyConnection(token, locationId);
    if (!verified.ok) {
      return { success: false, connected: false, error: verified.error };
    }

    const storedKey = incomingKey
      ? ghl.encryptStoredSecret(incomingKey, process.env.ENCRYPTION_KEY)
      : currentConfig.api_key;

    const data = {
      integration_name: ghl.GHL_INTEGRATION_NAME,
      is_enabled: params.is_enabled !== false,
      company_id: companyId,
      config: {
        ...currentConfig,
        location_id: locationId,
        location_name: verified.location_name || currentConfig.location_name || null,
        api_key: storedKey,
        api_key_last4: incomingKey ? incomingKey.slice(-4) : currentConfig.api_key_last4 || null,
        push_new_leads: params.push_new_leads !== false,
        import_contacts: params.import_contacts !== false,
        last_connection_at: new Date().toISOString(),
        last_sync_error: null,
      },
    };

    if (settingsRow?.id) {
      await pool.query(
        `UPDATE generic_entities SET data = $1::jsonb, updated_date = NOW() WHERE id = $2`,
        [JSON.stringify(data), settingsRow.id]
      );
    } else {
      const newId = generateEntityId('ghlset');
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'IntegrationSetting', $2, $3::jsonb, NOW(), NOW())`,
        [newId, companyId, JSON.stringify(data)]
      );
    }

    const saved = await loadGhlSettings(pool, companyId);
    return {
      success: true,
      message: 'GoHighLevel connected',
      ...ghl.publicStatusFromSettings(saved, { envFallbackConfigured: Boolean(process.env.GHL_API_KEY) }),
    };
  }

  async function syncGHLContacts(params = {}, _apiKey, req) {
    const isCron = params.__cron === true;
    let user = null;
    if (!isCron) {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      user = auth.user;
    }

    const pool = getPool();
    const companyId = isCron
      ? params.company_id
      : await resolveAuthorizedCompanyId(pool, user, params.company_id);
    if (!companyId) return { success: false, error: 'Company ID required' };

    const settingsRow = await loadGhlSettings(pool, companyId);
    if (!settingsRow && !process.env.GHL_API_KEY) {
      return { success: false, error: 'GHL integration is not configured. Open Settings → Integrations → GoHighLevel and save a token + Location ID.' };
    }
    if (settingsRow?.data?.is_enabled === false) {
      return { success: false, error: 'GHL integration is disabled for this company' };
    }

    const { token, locationId, config } = await credentialsForCompany(pool, companyId, settingsRow);
    if (!token) return { success: false, error: 'GHL token not configured. Paste a Private Integration token or set GHL_API_KEY.' };
    if (!locationId) return { success: false, error: 'Location ID not configured in GHL settings' };

    try {
      const importEnabled = params.import_contacts !== false && config.import_contacts !== false;
      const pushEnabled = params.push_new_leads !== false && config.push_new_leads !== false;
      const importResult = importEnabled
        ? await importContacts({
          pool, token, locationId, companyId,
          ownerEmail: user?.email || null,
          maxContacts: params.limit || null,
        })
        : { created: 0, updated: 0, total: 0, pages: 0, errors: [] };
      const exportResult = pushEnabled
        ? await exportUnsyncedLeads(pool, companyId, token, locationId)
        : { pushed: 0, skipped: 0, errors: [], considered: 0 };

      const result = {
        success: true,
        imported: importResult,
        exported: exportResult,
        created: importResult.created,
        updated: importResult.updated,
        total: importResult.total,
        pushed: exportResult.pushed,
        skipped: exportResult.skipped,
        errors: [...(importResult.errors || []), ...(exportResult.errors || [])],
        message: `Imported ${importResult.total} GHL contacts (${importResult.created} new, ${importResult.updated} updated). Pushed ${exportResult.pushed} new CompanySync leads to GoHighLevel.`,
      };

      await persistSyncResult(pool, settingsRow, companyId, {
        last_sync_at: new Date().toISOString(),
        last_sync_error: null,
        last_sync_result: {
          created: result.created,
          updated: result.updated,
          pushed: result.pushed,
          total: result.total,
        },
      });
      return result;
    } catch (err) {
      await persistSyncResult(pool, settingsRow, companyId, {
        last_sync_at: new Date().toISOString(),
        last_sync_error: err.message,
      });
      return { success: false, error: err.message };
    }
  }

  async function pushToGHL(params = {}, _apiKey, req) {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const pool = getPool();
    const { entityType = 'Lead', entityId, action = 'create' } = params;
    if (!entityId) return { success: false, error: 'entityId is required' };

    const leadRes = await pool.query(`SELECT * FROM leads WHERE id = $1 LIMIT 1`, [entityId]);
    if (leadRes.rows.length === 0) return { success: false, error: `${entityType} not found: ${entityId}` };
    const lead = leadRes.rows[0];

    const companyId = await resolveAuthorizedCompanyId(pool, auth.user, lead.company_id);
    if (!companyId || companyId !== lead.company_id) {
      if (!auth.user.is_super_admin && auth.user.platform_role !== 'super_admin') {
        return { success: false, error: 'Unauthorized' };
      }
    }

    const settingsRow = await loadGhlSettings(pool, lead.company_id);
    const { token, locationId, config } = await credentialsForCompany(pool, lead.company_id, settingsRow);
    if (!token) return { success: false, error: 'GHL token not configured' };
    if (!locationId) return { success: false, error: 'Location ID not configured in GHL settings' };
    if (config.push_new_leads === false && action === 'create') {
      return { success: false, skipped: true, message: 'Push new leads is disabled' };
    }

    if (action === 'update' && lead.ghl_contact_id) {
      const body = ghl.leadToGhlContact(lead, locationId);
      const updated = await ghlFetch(ghl.buildUpdateContactUrl(lead.ghl_contact_id), { token, method: 'PUT', body });
      if (!updated.ok) {
        return { success: false, error: `GHL update failed (${updated.status}): ${(updated.text || '').slice(0, 300)}` };
      }
      return { success: true, ghlContactId: lead.ghl_contact_id, message: 'Contact updated in GoHighLevel' };
    }

    return pushLeadToGhl(pool, lead, token, locationId);
  }

  async function testSyncOneGHL(params = {}, apiKey, req) {
    return syncGHLContacts({ ...params, limit: 1 }, apiKey, req);
  }

  async function testGHLWebhook(_params, _apiKey, req) {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    return {
      success: true,
      message: 'Webhook endpoint is ready to receive events.',
      endpoint_url: 'https://getcompanysync.com/api/functions/ghlWebhook',
    };
  }

  async function ghlAutoSyncCron() {
    const pool = getPool();
    const enabled = await pool.query(
      `SELECT company_id, data FROM generic_entities
       WHERE entity_type = 'IntegrationSetting'
         AND (LOWER(data->>'integration_name') = 'gohighlevel'
           OR LOWER(REPLACE(data->>'integration_name', ' ', '')) = 'gohighlevel')
         AND (data->>'is_enabled' IS NULL OR data->>'is_enabled' = 'true')`
    );
    const results = [];
    for (const row of enabled.rows) {
      try {
        const result = await syncGHLContacts({ company_id: row.company_id, __cron: true });
        results.push({ companyId: row.company_id, ...result });
      } catch (err) {
        results.push({ companyId: row.company_id, error: err.message });
      }
    }
    return { success: true, results };
  }

  return {
    getGHLStatus,
    saveGHLSettings,
    syncGHLContacts,
    pushToGHL,
    testSyncOneGHL,
    testGHLWebhook,
    ghlAutoSyncCron,
  };
}

module.exports = { createGhlHandlers };
