'use strict';

// Rewrite ciphertext that still uses ENCRYPTION_KEY_PREVIOUS so it uses
// ENCRYPTION_KEY. Safe to run more than once: values that already decrypt
// with the current key are left as they are. Logs counts only.

const {
  CIPHER_RE,
  currentKey,
  previousKey,
  encryptWithKey,
  decryptWithKey,
} = require('./encryption.cjs');

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCAN_RE = '[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]{2,}';

function quoteIdent(name) {
  if (!IDENT.test(name)) throw new Error('Unexpected SQL identifier');
  return `"${name}"`;
}

function rewriteNode(value, current, prev, stats) {
  if (typeof value === 'string') {
    if (!CIPHER_RE.test(value)) return { value, changed: false };
    try {
      decryptWithKey(value, current);
      stats.alreadyCurrent += 1;
      return { value, changed: false };
    } catch {
      /* try the previous key */
    }
    try {
      const plain = decryptWithKey(value, prev);
      stats.rewritten += 1;
      return { value: encryptWithKey(plain, current), changed: true };
    } catch {
      stats.failed += 1;
      return { value, changed: false };
    }
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const rewritten = rewriteNode(item, current, prev, stats);
      if (rewritten.changed) changed = true;
      return rewritten.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      const rewritten = rewriteNode(child, current, prev, stats);
      next[key] = rewritten.value;
      if (rewritten.changed) changed = true;
    }
    return { value: changed ? next : value, changed };
  }
  return { value, changed: false };
}

async function primaryKeyColumns(pool, table) {
  const { rows } = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [table]
  );
  return rows.map((row) => row.column_name).filter((name) => IDENT.test(name));
}

async function reencryptStoredSecrets(pool, env = process.env, log = console) {
  const prev = previousKey(env);
  if (!prev) {
    const raw = env.ENCRYPTION_KEY_PREVIOUS;
    const reason = raw != null && String(raw).trim() !== '' ? 'previous_key_unusable' : 'previous_key_absent';
    log.info(`[reencrypt] rewritten=0 already_current=0 failed=0 reason=${reason}`);
    return { rewritten: 0, alreadyCurrent: 0, failed: 0, rowsUpdated: 0, reason };
  }
  const current = currentKey(env);
  const stats = { rewritten: 0, alreadyCurrent: 0, failed: 0, rowsUpdated: 0, reason: 'ok' };

  const { rows: columns } = await pool.query(
    `SELECT c.table_name, c.column_name, c.data_type
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.data_type IN ('text', 'character varying', 'jsonb')
     ORDER BY c.table_name, c.ordinal_position`
  );

  const keysByTable = new Map();
  for (const column of columns) {
    if (!IDENT.test(column.table_name) || !IDENT.test(column.column_name)) continue;
    if (!keysByTable.has(column.table_name)) {
      keysByTable.set(column.table_name, await primaryKeyColumns(pool, column.table_name));
    }
    const pk = keysByTable.get(column.table_name);
    if (!pk.length || pk.includes(column.column_name)) continue;

    const tableSql = quoteIdent(column.table_name);
    const columnSql = quoteIdent(column.column_name);
    const pkSql = pk.map(quoteIdent).join(', ');
    const found = await pool.query(
      `SELECT ${pkSql}, ${columnSql} AS secret_value
       FROM ${tableSql}
       WHERE ${columnSql}::text ~ $1`,
      [SCAN_RE]
    );

    for (const row of found.rows) {
      const rewritten = rewriteNode(row.secret_value, current, prev, stats);
      if (!rewritten.changed) continue;
      const assignments = pk.map((name, index) => `${quoteIdent(name)} = $${index + 2}`);
      const params = [column.data_type === 'jsonb' ? JSON.stringify(rewritten.value) : rewritten.value];
      for (const name of pk) params.push(row[name]);
      const cast = column.data_type === 'jsonb' ? '$1::jsonb' : '$1';
      await pool.query(
        `UPDATE ${tableSql} SET ${columnSql} = ${cast} WHERE ${assignments.join(' AND ')}`,
        params
      );
      stats.rowsUpdated += 1;
    }
  }

  log.info(`[reencrypt] rewritten=${stats.rewritten} already_current=${stats.alreadyCurrent} failed=${stats.failed} rows_updated=${stats.rowsUpdated}`);
  return stats;
}

module.exports = { reencryptStoredSecrets, rewriteNode };
