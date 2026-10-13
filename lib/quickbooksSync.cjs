'use strict';

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QB_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';

function getApiBase(realmId, sandbox = false) {
  return `${sandbox ? QB_SANDBOX_BASE : QB_API_BASE}/${realmId}`;
}

async function refreshQBToken(cfg, pool, companyId) {
  const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
  const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) throw new Error('QB credentials not configured');
  if (!cfg.refresh_token) throw new Error('No refresh token — please reconnect QuickBooks');

  const resp = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refresh_token })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    // Include the HTTP status so callers can distinguish auth failures (401/400
    // with invalid_grant) from transient errors without parsing the body.
    throw new Error(`QB token refresh failed (${resp.status}): ${txt}`);
  }
  const tokens = await resp.json();
  const accessToken = tokens.access_token;

  // Always persist the fresh access token (and rotated refresh token, if any).
  // Shallow JSONB merge so we never clobber fields written by other paths
  // (e.g. the connection check self-healing qb_environment/qb_company_name).
  const now = Date.now();
  const patch = {
    access_token: accessToken,
    token_expires_at: new Date(now + (tokens.expires_in || 3600) * 1000).toISOString(),
    // Using the refresh token resets QB's 100-day idle-expiry window. Track the
    // new expiry so the nightly cron can warn admins when it's approaching.
    refresh_token_expires_at: new Date(now + 100 * 24 * 60 * 60 * 1000).toISOString(),
    last_token_refresh_at: new Date(now).toISOString()
  };
  if (tokens.refresh_token && tokens.refresh_token !== cfg.refresh_token) {
    patch.refresh_token = tokens.refresh_token;
  }
  const updated = { ...cfg, ...patch };
  try {
    await pool.query(
      `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE entity_type = 'QuickBooksSettings' AND company_id = $2`,
      [JSON.stringify(patch), companyId]
    );
  } catch (e) {
    console.warn('[QB] Failed to persist refreshed token for', companyId, e.message);
  }
  return { accessToken, cfg: updated };
}

async function loadQBSettings(pool, companyId) {
  const res = await pool.query(
    `SELECT data FROM generic_entities WHERE entity_type = 'QuickBooksSettings' AND company_id = $1 LIMIT 1`,
    [companyId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].data;
}

async function upsertQBCustomer(accessToken, apiBase, customerName, customerEmail) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  const safeName = (customerName || 'Unknown Customer').replace(/['"]/g, '').trim();
  const query = `SELECT * FROM Customer WHERE DisplayName = '${safeName}' MAXRESULTS 1`;
  const searchResp = await fetch(`${apiBase}/query?query=${encodeURIComponent(query)}`, { headers });
  const searchData = await searchResp.json();

  if (searchData.QueryResponse?.Customer?.length > 0) {
    return searchData.QueryResponse.Customer[0].Id;
  }

  const newCustBody = { DisplayName: safeName };
  if (customerEmail) newCustBody.PrimaryEmailAddr = { Address: customerEmail };
  const createResp = await fetch(`${apiBase}/customer`, {
    method: 'POST', headers, body: JSON.stringify(newCustBody)
  });
  const createData = await createResp.json();
  if (!createData.Customer) {
    throw new Error(`QB customer create failed: ${JSON.stringify(createData.Fault || createData)}`);
  }
  return createData.Customer.Id;
}

function buildQBLineItems(items, totalAmount) {
  const parsed = typeof items === 'string' ? JSON.parse(items || '[]') : (items || []);
  const lines = parsed
    .filter(item => (parseFloat(item.amount || item.total || 0)) > 0)
    .map(item => ({
      DetailType: 'SalesItemLineDetail',
      Amount: parseFloat(item.amount || item.total || 0),
      Description: (item.description || item.name || 'Service').substring(0, 4000),
      SalesItemLineDetail: {
        Qty: parseFloat(item.quantity || 1),
        UnitPrice: parseFloat(item.rate || item.unit_price || 0)
      }
    }));

  if (lines.length === 0) {
    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: parseFloat(totalAmount || 0),
      Description: 'Roofing Services',
      SalesItemLineDetail: { Qty: 1, UnitPrice: parseFloat(totalAmount || 0) }
    });
  }
  return lines;
}

async function pushInvoiceToQB(pool, companyId, invoice) {
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { skipped: true, reason: 'QB not connected' };

  const { accessToken, cfg: updatedCfg } = await refreshQBToken(cfg, pool, companyId);
  const apiBase = getApiBase(updatedCfg.realm_id, updatedCfg.qb_environment === 'sandbox');
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const customerId = await upsertQBCustomer(accessToken, apiBase, invoice.customer_name, invoice.customer_email);
  const lineItems = buildQBLineItems(invoice.items, invoice.total_amount);

  const txnDate = invoice.issue_date
    ? new Date(invoice.issue_date).toISOString().split('T')[0]
    : new Date(invoice.created_at || Date.now()).toISOString().split('T')[0];

  const qbInvoice = {
    CustomerRef: { value: customerId },
    Line: lineItems,
    TxnDate: txnDate,
    DocNumber: invoice.invoice_number || undefined,
    PrivateNote: invoice.notes || undefined
  };
  if (invoice.due_date) {
    try { qbInvoice.DueDate = new Date(invoice.due_date).toISOString().split('T')[0]; } catch (e) {}
  }

  if (invoice.quickbooks_invoice_id) {
    const existing = await fetch(`${apiBase}/invoice/${invoice.quickbooks_invoice_id}`, { headers });
    const existingData = await existing.json();
    if (existingData.Invoice) {
      const updateBody = { ...qbInvoice, Id: invoice.quickbooks_invoice_id, SyncToken: existingData.Invoice.SyncToken, sparse: true };
      const updateResp = await fetch(`${apiBase}/invoice`, { method: 'POST', headers, body: JSON.stringify(updateBody) });
      const updateData = await updateResp.json();
      if (!updateData.Invoice) {
        const errMsg = JSON.stringify(updateData.Fault || updateData);
        await appendSyncLog(pool, companyId, { type: 'invoice', id: invoice.id, label: `Invoice ${invoice.invoice_number || ''}`.trim(), status: 'error', error: errMsg.slice(0, 200) });
        return { error: 'QB invoice update failed', details: errMsg };
      }
      await pool.query(`UPDATE invoices SET quickbooks_invoice_id = $1, updated_at = NOW() WHERE id = $2`, [updateData.Invoice.Id, invoice.id]);
      await appendSyncLog(pool, companyId, { type: 'invoice', id: invoice.id, label: `Invoice ${invoice.invoice_number || ''}`.trim(), status: 'success', action: 'updated' });
      return { success: true, quickbooks_invoice_id: updateData.Invoice.Id, action: 'updated' };
    }
  }

  const createResp = await fetch(`${apiBase}/invoice`, { method: 'POST', headers, body: JSON.stringify(qbInvoice) });
  const createData = await createResp.json();
  if (!createData.Invoice) {
    const errMsg = JSON.stringify(createData.Fault || createData);
    await appendSyncLog(pool, companyId, { type: 'invoice', id: invoice.id, label: `Invoice ${invoice.invoice_number || ''}`.trim(), status: 'error', error: errMsg.slice(0, 200) });
    return { error: 'QB invoice create failed', details: errMsg };
  }

  await pool.query(`UPDATE invoices SET quickbooks_invoice_id = $1, updated_at = NOW() WHERE id = $2`, [createData.Invoice.Id, invoice.id]);
  await appendSyncLog(pool, companyId, { type: 'invoice', id: invoice.id, label: `Invoice ${invoice.invoice_number || ''}`.trim(), status: 'success', action: 'created' });
  return { success: true, quickbooks_invoice_id: createData.Invoice.Id, action: 'created' };
}

async function pushPaymentToQB(pool, companyId, payment) {
  // Withheld-fee offset payments (e.g. Sedgwick MRP keeps its % out of the claim
  // check) are bookkeeping entries — no cash was received, and the matching
  // Expense is not synced to QB. Pushing them would show phantom cash in QB.
  if (payment?.is_withheld_offset === true || payment?.data?.is_withheld_offset === true
      || /no cash received/i.test(payment?.notes || '')) {
    return { skipped: true, reason: 'Withheld-fee offset payment — not synced to QuickBooks' };
  }
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { skipped: true, reason: 'QB not connected' };

  const { accessToken, cfg: updatedCfg } = await refreshQBToken(cfg, pool, companyId);
  const apiBase = getApiBase(updatedCfg.realm_id, updatedCfg.qb_environment === 'sandbox');
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const customerId = await upsertQBCustomer(accessToken, apiBase, payment.customer_name, null);

  const paymentBody = {
    CustomerRef: { value: customerId },
    TotalAmt: parseFloat(payment.amount || 0),
    TxnDate: payment.payment_date
      ? new Date(payment.payment_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    PrivateNote: [payment.payment_method, payment.reference_number, payment.notes].filter(Boolean).join(' | ') || undefined
  };

  if (payment.invoice_id) {
    const invRes = await pool.query(`SELECT quickbooks_invoice_id FROM invoices WHERE id = $1 LIMIT 1`, [payment.invoice_id]);
    const qbInvId = invRes.rows[0]?.quickbooks_invoice_id;
    if (qbInvId) {
      paymentBody.Line = [{
        Amount: parseFloat(payment.amount || 0),
        LinkedTxn: [{ TxnId: qbInvId, TxnType: 'Invoice' }]
      }];
    }
  }

  if (payment.quickbooks_payment_id) {
    return { success: true, quickbooks_payment_id: payment.quickbooks_payment_id, action: 'already_synced' };
  }

  const createResp = await fetch(`${apiBase}/payment`, { method: 'POST', headers, body: JSON.stringify(paymentBody) });
  const createData = await createResp.json();
  if (!createData.Payment) {
    const errMsg = JSON.stringify(createData.Fault || createData);
    await appendSyncLog(pool, companyId, { type: 'payment', id: payment.id, label: `Payment $${parseFloat(payment.amount || 0).toFixed(2)}`, status: 'error', error: errMsg.slice(0, 200) });
    return { error: 'QB payment create failed', details: errMsg };
  }

  await pool.query(`UPDATE payments SET quickbooks_payment_id = $1, updated_at = NOW() WHERE id = $2`, [createData.Payment.Id, payment.id]);
  await appendSyncLog(pool, companyId, { type: 'payment', id: payment.id, label: `Payment $${parseFloat(payment.amount || 0).toFixed(2)}`, status: 'success', action: 'created' });
  return { success: true, quickbooks_payment_id: createData.Payment.Id, action: 'created' };
}

async function updateLastSync(pool, companyId) {
  await pool.query(
    `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE entity_type = 'QuickBooksSettings' AND company_id = $2`,
    [JSON.stringify({ last_sync: new Date().toISOString() }), companyId]
  );
}

async function appendSyncLog(pool, companyId, entry) {
  try {
    const res = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'QuickBooksSettings' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    if (!res.rows.length) return;
    const cfg = res.rows[0].data;
    const existing = Array.isArray(cfg.sync_log) ? cfg.sync_log : [];
    const newEntry = { ...entry, ts: new Date().toISOString() };
    const updated = [newEntry, ...existing].slice(0, 50);
    const patch = { sync_log: updated };
    if (entry.status === 'success') patch.last_sync = newEntry.ts;
    await pool.query(
      `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE entity_type = 'QuickBooksSettings' AND company_id = $2`,
      [JSON.stringify(patch), companyId]
    );
  } catch (e) {
    console.warn('[QB] appendSyncLog failed:', e.message);
  }
}

async function bulkSyncToQB(pool, companyId, { syncInvoices = true, syncPayments = true } = {}) {
  const results = { invoices: { synced: 0, skipped: 0, errors: [] }, payments: { synced: 0, skipped: 0, errors: [] } };

  if (syncInvoices) {
    const invRows = await pool.query(
      `SELECT * FROM invoices WHERE company_id = $1 AND status NOT IN ('draft','cancelled','void') ORDER BY created_at DESC`,
      [companyId]
    );
    for (const inv of invRows.rows) {
      try {
        const r = await pushInvoiceToQB(pool, companyId, inv);
        if (r.skipped) { results.invoices.skipped++; break; }
        if (r.error) results.invoices.errors.push({ id: inv.id, invoice_number: inv.invoice_number, error: r.error });
        else results.invoices.synced++;
      } catch (e) {
        results.invoices.errors.push({ id: inv.id, invoice_number: inv.invoice_number, error: e.message });
      }
    }
  }

  if (syncPayments) {
    const pmtRows = await pool.query(
      `SELECT * FROM payments WHERE company_id = $1 AND status NOT IN ('failed','void','cancelled') ORDER BY created_at DESC`,
      [companyId]
    );
    for (const pmt of pmtRows.rows) {
      try {
        const r = await pushPaymentToQB(pool, companyId, pmt);
        if (r.skipped) { results.payments.skipped++; break; }
        if (r.error) results.payments.errors.push({ id: pmt.id, amount: pmt.amount, error: r.error });
        else results.payments.synced++;
      } catch (e) {
        results.payments.errors.push({ id: pmt.id, amount: pmt.amount, error: e.message });
      }
    }
  }

  return results;
}

async function getQBSyncStatus(pool, companyId) {
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { connected: false, was_connected: !!cfg };

  const [invTotal, invSynced, pmtTotal, pmtSynced] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM invoices WHERE company_id = $1 AND status NOT IN ('draft','cancelled','void')`, [companyId]),
    pool.query(`SELECT COUNT(*) FROM invoices WHERE company_id = $1 AND quickbooks_invoice_id IS NOT NULL`, [companyId]),
    pool.query(`SELECT COUNT(*) FROM payments WHERE company_id = $1 AND status NOT IN ('failed','void','cancelled')`, [companyId]),
    pool.query(`SELECT COUNT(*) FROM payments WHERE company_id = $1 AND quickbooks_payment_id IS NOT NULL`, [companyId])
  ]);

  return {
    connected: true,
    realm_id: cfg.realm_id,
    sandbox: cfg.qb_environment === 'sandbox',
    qb_company_name: cfg.qb_company_name,
    last_sync: cfg.last_sync || null,
    sync_log: Array.isArray(cfg.sync_log) ? cfg.sync_log : [],
    invoices: {
      total: parseInt(invTotal.rows[0].count),
      synced: parseInt(invSynced.rows[0].count),
      unsynced: parseInt(invTotal.rows[0].count) - parseInt(invSynced.rows[0].count)
    },
    payments: {
      total: parseInt(pmtTotal.rows[0].count),
      synced: parseInt(pmtSynced.rows[0].count),
      unsynced: parseInt(pmtTotal.rows[0].count) - parseInt(pmtSynced.rows[0].count)
    }
  };
}

const QB_ACCOUNT_TYPE_MAP = {
  'Bank':                     { type: 'asset',     subtype: 'current_assets' },
  'Accounts Receivable':      { type: 'asset',     subtype: 'current_assets' },
  'Other Current Asset':      { type: 'asset',     subtype: 'current_assets' },
  'Fixed Asset':              { type: 'asset',     subtype: 'fixed_assets' },
  'Other Asset':              { type: 'asset',     subtype: 'non_current_assets' },
  'Accounts Payable':         { type: 'liability', subtype: 'current_liabilities' },
  'Credit Card':              { type: 'liability', subtype: 'current_liabilities' },
  'Other Current Liability':  { type: 'liability', subtype: 'current_liabilities' },
  'Long Term Liability':      { type: 'liability', subtype: 'non_current_liabilities' },
  'Equity':                   { type: 'equity',    subtype: 'owner_equity' },
  'Retained Earnings':        { type: 'equity',    subtype: 'owner_equity' },
  'Income':                   { type: 'revenue',   subtype: 'income' },
  'Other Income':             { type: 'revenue',   subtype: 'other_income' },
  'Cost of Goods Sold':       { type: 'cogs',      subtype: 'cost_of_sales' },
  'Expense':                  { type: 'expense',   subtype: 'operating_expenses' },
  'Other Expense':            { type: 'expense',   subtype: 'other_expenses' },
};

async function importQBChartOfAccounts(pool, companyId) {
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { skipped: true, reason: 'QB not connected' };

  const { accessToken, cfg: updatedCfg } = await refreshQBToken(cfg, pool, companyId);
  const apiBase = getApiBase(updatedCfg.realm_id, updatedCfg.qb_environment === 'sandbox');
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' };

  const query = `SELECT * FROM Account MAXRESULTS 1000`;
  const resp = await fetch(`${apiBase}/query?query=${encodeURIComponent(query)}&minorversion=65`, { headers });
  const data = await resp.json();

  const qbAccounts = data?.QueryResponse?.Account || [];
  if (qbAccounts.length === 0) return { success: true, imported: 0, message: 'No accounts found in QuickBooks' };

  let imported = 0;
  let skipped = 0;
  const { randomUUID } = require('crypto');

  for (const acc of qbAccounts) {
    const mapped = QB_ACCOUNT_TYPE_MAP[acc.AccountType] || { type: 'asset', subtype: 'current_assets' };
    const accNumber = acc.AcctNum || String(acc.Id).padStart(4, '0');
    const accName = acc.FullyQualifiedName || acc.Name;

    const existing = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'ChartOfAccounts' AND company_id = $1 AND (data->>'quickbooks_account_id' = $2 OR data->>'account_name' = $3) LIMIT 1`,
      [companyId, String(acc.Id), accName]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE id = $2`,
        [JSON.stringify({
          account_number: accNumber,
          account_name: accName,
          account_type: mapped.type,
          account_subtype: mapped.subtype,
          balance: parseFloat(acc.CurrentBalance || 0),
          quickbooks_account_id: String(acc.Id),
          is_active: acc.Active !== false
        }), existing.rows[0].id]
      );
      skipped++;
    } else {
      const entityData = {
        company_id: companyId,
        account_number: accNumber,
        account_name: accName,
        account_type: mapped.type,
        account_subtype: mapped.subtype,
        balance: parseFloat(acc.CurrentBalance || 0),
        description: acc.Description || '',
        quickbooks_account_id: String(acc.Id),
        is_active: acc.Active !== false,
        is_system_account: true,
        source: 'quickbooks'
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'ChartOfAccounts', $2, $3, NOW(), NOW())`,
        [randomUUID(), companyId, JSON.stringify(entityData)]
      );
      imported++;
    }
  }

  await updateLastSync(pool, companyId);
  return { success: true, imported, updated: skipped, total: qbAccounts.length };
}

async function importQBBankAccounts(pool, companyId) {
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { skipped: true, reason: 'QB not connected' };

  const { accessToken, cfg: updatedCfg } = await refreshQBToken(cfg, pool, companyId);
  const apiBase = getApiBase(updatedCfg.realm_id, updatedCfg.qb_environment === 'sandbox');
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' };

  const query = `SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 100`;
  const resp = await fetch(`${apiBase}/query?query=${encodeURIComponent(query)}&minorversion=65`, { headers });
  const data = await resp.json();

  const bankAccounts = data?.QueryResponse?.Account || [];
  if (bankAccounts.length === 0) return { success: true, imported: 0, message: 'No bank accounts found in QuickBooks' };

  let imported = 0;
  let skipped = 0;
  const { randomUUID } = require('crypto');

  for (const acc of bankAccounts) {
    const existing = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'BankAccount' AND company_id = $1 AND data->>'quickbooks_account_id' = $2 LIMIT 1`,
      [companyId, String(acc.Id)]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE id = $2`,
        [JSON.stringify({
          current_balance: parseFloat(acc.CurrentBalance || 0),
          is_active: acc.Active !== false
        }), existing.rows[0].id]
      );
      skipped++;
    } else {
      const entityData = {
        company_id: companyId,
        account_name: acc.FullyQualifiedName || acc.Name,
        bank_name: 'QuickBooks',
        account_type: 'checking',
        account_number_last4: acc.AcctNum ? acc.AcctNum.slice(-4) : '',
        current_balance: parseFloat(acc.CurrentBalance || 0),
        opening_balance: parseFloat(acc.CurrentBalance || 0),
        last_reconciled_balance: 0,
        is_active: acc.Active !== false,
        quickbooks_account_id: String(acc.Id),
        chart_account_id: String(acc.Id),
        source: 'quickbooks'
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'BankAccount', $2, $3, NOW(), NOW())`,
        [randomUUID(), companyId, JSON.stringify(entityData)]
      );
      imported++;
    }
  }

  await updateLastSync(pool, companyId);
  return { success: true, imported, updated: skipped, total: bankAccounts.length };
}

function mapQBCategory(accountName = '') {
  const n = String(accountName).toLowerCase();
  if (n.includes('cogs') || n.includes('cost of goods')) return 'cogs';
  if (n.includes('material')) return 'materials';
  if (n.includes('labor') || n.includes('wages') || n.includes('payroll')) return 'labor';
  if (n.includes('subcontract')) return 'subcontractor';
  if (n.includes('equipment') || n.includes('tools')) return 'equipment';
  if (n.includes('fuel') || n.includes('gas')) return 'fuel';
  if (n.includes('software') || n.includes('subscription')) return 'software';
  if (n.includes('rent') || n.includes('lease')) return 'rent';
  if (n.includes('utilities') || n.includes('electric') || n.includes('internet') || n.includes('water')) return 'utilities';
  if (n.includes('insurance')) return 'insurance';
  if (n.includes('marketing') || n.includes('ads') || n.includes('advertising') || n.includes('facebook') || n.includes('google')) return 'marketing';
  if (n.includes('tax')) return 'taxes';
  if (n.includes('meals') || n.includes('restaurant') || n.includes('food')) return 'meals';
  if (n.includes('travel') || n.includes('hotel') || n.includes('airfare') || n.includes('flight')) return 'travel';
  if (n.includes('office') || n.includes('supplies')) return 'office_supplies';
  if (n.includes('telephone') || n.includes('phone') || n.includes('cell')) return 'phone';
  return 'other';
}

async function importQBExpenses(pool, companyId, { startDate, endDate, maxResults = 500 } = {}) {
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { skipped: true, reason: 'QB not connected' };

  const { accessToken, cfg: updatedCfg } = await refreshQBToken(cfg, pool, companyId);
  const apiBase = getApiBase(updatedCfg.realm_id, updatedCfg.qb_environment === 'sandbox');
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' };

  // QB Purchase covers checks, credit card charges, and cash expenses
  let whereClauses = [];
  if (startDate) whereClauses.push(`TxnDate >= '${startDate}'`);
  if (endDate) whereClauses.push(`TxnDate <= '${endDate}'`);
  let query = `SELECT * FROM Purchase`;
  if (whereClauses.length) query += ` WHERE ${whereClauses.join(' AND ')}`;
  query += ` ORDERBY TxnDate DESC MAXRESULTS ${maxResults}`;

  const resp = await fetch(`${apiBase}/query?query=${encodeURIComponent(query)}&minorversion=65`, { headers });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`QB Purchase query failed (${resp.status}): ${txt}`);
  }
  const data = await resp.json();
  const purchases = data?.QueryResponse?.Purchase || [];

  const { randomUUID } = require('crypto');
  let imported = 0, skipped = 0, errors = [];

  for (const purchase of purchases) {
    const qbId = String(purchase.Id);
    const marker = `qb_purchase_id:${qbId}`;

    // Deduplicate by QB purchase ID stored in reference_number or notes
    const dupCheck = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'Expense' AND company_id = $1 AND (data->>'reference_number' = $2 OR data->>'notes' LIKE $3) LIMIT 1`,
      [companyId, `QB:${qbId}`, `%${marker}%`]
    );
    if (dupCheck.rows.length > 0) { skipped++; continue; }

    const amount = parseFloat(purchase.TotalAmt || 0);
    if (amount <= 0) { skipped++; continue; }

    // Vendor from EntityRef (payee), fall back to AccountRef (payment account)
    const vendorName = purchase.EntityRef?.name || purchase.AccountRef?.name || 'Unknown Vendor';

    // Category from first expense line's account
    const lines = purchase.Line || [];
    const firstLine = lines.find(l => l.DetailType === 'AccountBasedExpenseLineDetail' || l.DetailType === 'ItemBasedExpenseLineDetail') || lines[0];
    const accountName = firstLine?.AccountBasedExpenseLineDetail?.AccountRef?.name
      || firstLine?.ItemBasedExpenseLineDetail?.ItemRef?.name
      || '';
    const description = lines.map(l => l.Description).filter(Boolean).join('; ') || purchase.PrivateNote || vendorName;

    // Map QB PaymentType to CS payment method
    const pmMap = { Cash: 'cash', Check: 'check', CreditCard: 'credit_card' };
    const paymentMethod = pmMap[purchase.PaymentType] || 'other';

    const expenseData = JSON.stringify({
      company_id: companyId,
      expense_date: purchase.TxnDate || new Date().toISOString().split('T')[0],
      vendor_name: vendorName,
      category: mapQBCategory(accountName || vendorName),
      amount,
      description,
      payment_method: paymentMethod,
      reference_number: `QB:${qbId}`,
      notes: `synced_from_quickbooks | ${marker}`,
      status: 'paid',
      tax_deductible: true,
    });

    try {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Expense', $2, $3, NOW(), NOW())`,
        [randomUUID(), companyId, expenseData]
      );
      imported++;
    } catch (e) {
      errors.push({ qb_id: qbId, error: e.message });
    }
  }

  return { success: true, imported, skipped, errors, total: purchases.length };
}

// Pull QB Payments from the last 90 days and create Transaction generic_entities
// so they appear in Bank Reconciliation's unreconciled list.
//
// Why Payments only (not Invoices):
//   QB Invoices are Accounts-Receivable entries — they record what was billed,
//   not what hit the bank. Bank Reconciliation matches transactions against bank
//   account IDs (chart_account_id = QB account Id stored by importQBBankAccounts).
//   Payments carry a DepositToAccountRef that identifies the receiving bank
//   account, so they link correctly to the selected bank account. Invoice AR
//   account IDs never appear in the BankAccount list and would be silently
//   filtered out, creating phantom "imported but invisible" rows.
//
// Pagination: QB caps individual query pages at 1000 rows. We walk STARTPOSITION
//   in steps of 1000 until we get an empty page so no records are silently lost.
//
// Deduplication: re-import is safe — each row is keyed by quickbooks_transaction_id.
async function importQBTransactions(pool, companyId) {
  const cfg = await loadQBSettings(pool, companyId);
  if (!cfg || !cfg.is_connected) return { skipped: true, reason: 'QB not connected' };

  const { accessToken, cfg: updatedCfg } = await refreshQBToken(cfg, pool, companyId);
  const apiBase = getApiBase(updatedCfg.realm_id, updatedCfg.qb_environment === 'sandbox');
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' };

  const { randomUUID } = require('crypto');
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let imported = 0, skipped = 0;
  const errors = [];
  const PAGE_SIZE = 1000;

  // ── Paginated QB Payment fetch ───────────────────────────────────────────
  // QB uses 1-based STARTPOSITION. We keep fetching until a page comes back
  // with fewer rows than PAGE_SIZE (i.e. the last page).
  const allPayments = [];
  let startPos = 1;
  while (true) {
    const q = `SELECT * FROM Payment WHERE TxnDate >= '${cutoff}' ORDERBY TxnDate DESC STARTPOSITION ${startPos} MAXRESULTS ${PAGE_SIZE}`;
    const resp = await fetch(`${apiBase}/query?query=${encodeURIComponent(q)}&minorversion=65`, { headers });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`QB Payment query failed (${resp.status}): ${txt}`);
    }
    const data = await resp.json();
    const page = data?.QueryResponse?.Payment || [];
    allPayments.push(...page);
    if (page.length < PAGE_SIZE) break;  // last page
    startPos += PAGE_SIZE;
  }

  // ── Upsert each payment as a Transaction entity ──────────────────────────
  for (const pmt of allPayments) {
    const qbId = `pmt_${pmt.Id}`;
    const dup = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'Transaction' AND company_id = $1 AND data->>'quickbooks_transaction_id' = $2 LIMIT 1`,
      [companyId, qbId]
    );
    if (dup.rows.length > 0) { skipped++; continue; }

    const amount = parseFloat(pmt.TotalAmt || 0);
    if (amount <= 0) { skipped++; continue; }

    // DepositToAccountRef.value = QB account ID of the receiving bank account.
    // importQBBankAccounts stores the same QB ID as chart_account_id, so the
    // reconciliation page client-side filter (debit_account_id === chart_account_id)
    // matches correctly when the user selects that bank account.
    const bankAcctId = pmt.DepositToAccountRef?.value ? String(pmt.DepositToAccountRef.value) : null;
    const desc = `Payment from ${pmt.CustomerRef?.name || 'Customer'}`
      + (pmt.DocNumber ? ` #${pmt.DocNumber}` : '')
      + (pmt.PrivateNote ? ` — ${pmt.PrivateNote}` : '');

    try {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Transaction', $2, $3, NOW(), NOW())`,
        [randomUUID(), companyId, JSON.stringify({
          company_id: companyId,
          transaction_date: pmt.TxnDate,
          description: desc.substring(0, 500),
          debit_account_id:  bankAcctId,  // receiving bank account QB ID
          debit_amount:      amount,
          credit_account_id: null,        // AR — not a bank account
          credit_amount:     0,
          amount,
          transaction_type:  'payment',
          reconciled:        false,
          quickbooks_transaction_id: qbId,
          source: 'quickbooks',
        })]
      );
      imported++;
    } catch (e) {
      errors.push({ qb_id: qbId, error: e.message });
    }
  }

  await updateLastSync(pool, companyId);
  return {
    success: true,
    imported,
    skipped,        // numeric duplicate count (never boolean here)
    errors,
    total:    allPayments.length,
    payments: allPayments.length,
  };
}

function getQBInvoiceUrl(realmId, qbId, sandbox = false) {
  if (!qbId) return null;
  const base = sandbox
    ? 'https://app.sandbox.qbo.intuit.com'
    : 'https://app.qbo.intuit.com';
  const params = new URLSearchParams({ txnId: String(qbId) });
  if (realmId) params.set('companyId', String(realmId));
  return `${base}/app/invoice?${params}`;
}

function getQBPaymentUrl(realmId, qbId, sandbox = false) {
  if (!qbId) return null;
  const base = sandbox
    ? 'https://app.sandbox.qbo.intuit.com'
    : 'https://app.qbo.intuit.com';
  const params = new URLSearchParams({ txnId: String(qbId) });
  if (realmId) params.set('companyId', String(realmId));
  return `${base}/app/recvpayment?${params}`;
}

module.exports = {
  pushInvoiceToQB, pushPaymentToQB, bulkSyncToQB, getQBSyncStatus,
  loadQBSettings, refreshQBToken, appendSyncLog,
  importQBChartOfAccounts, importQBBankAccounts, importQBExpenses, importQBTransactions,
  getQBInvoiceUrl, getQBPaymentUrl,
};
