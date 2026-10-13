'use strict';

const DENIED = 'Bulk deletion is restricted to platform Super Admins and the owner of this company.';

function contextError(ctx) {
  if (!ctx?.authenticated) return { status: 401, error: 'Unauthorized' };
  if (ctx.impersonationExpired) return { status: 401, error: 'Impersonation session expired.' };
  if (ctx.isImpersonating || ctx.viaServiceToken) return { status: 403, error: DENIED };
  return null;
}

async function canBulkDelete(pool, ctx, companyId) {
  if (contextError(ctx)) return false;
  // A tenant's staff "super admin" flag is not a platform-wide bulk-delete grant.
  if (ctx.platformRole === 'super_admin' ||
      (ctx.isSuperAdmin && ctx.allowedCompanyIds?.has('companysync_master_001'))) return true;
  if (!companyId || !ctx.email) return false;
  const result = await pool.query(
    'SELECT id FROM companies WHERE id = $1 AND LOWER(TRIM(created_by)) = $2',
    [companyId, String(ctx.email).trim().toLowerCase()]
  );
  return result.rows.length > 0;
}

// The caller supplies only server-owned table metadata and entity adapters.
// Authorize the complete set before deleting anything; roll back on any failure.
async function deleteBatch({ pool, ctx, entityType, table, ids, authorizeRecord, validateOnly = false }) {
  const denied = contextError(ctx);
  if (denied) return denied;
  if (entityType === 'companies') {
    return { status: 403, error: 'Company deletion must use the platform administration workflow.' };
  }
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 ||
      ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) {
    return { status: 400, error: 'Provide between 1 and 10000 valid record IDs.' };
  }
  if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid bulk-delete table');
  const uniqueIds = [...new Set(ids)].sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generic = table === 'generic_entities';
    const parameters = generic ? [uniqueIds, entityType] : [uniqueIds];
    const selection = `id = ANY($1)${generic ? ' AND entity_type = $2' : ''}`;
    const locked = await client.query(
      `SELECT * FROM ${table} WHERE ${selection} ORDER BY id FOR UPDATE`,
      parameters
    );
    if (locked.rows.length !== uniqueIds.length) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'One or more selected records no longer exist. Refresh the list.' };
    }
    const permittedCompanies = new Set();
    for (const record of locked.rows) {
      // Use the locked SQL ownership column, never client-editable JSONB metadata.
      const companyId = entityType === 'companies' ? record.id : record.company_id;
      if (!permittedCompanies.has(companyId)) {
        if (!await canBulkDelete(client, ctx, companyId)) {
          await client.query('ROLLBACK');
          return { status: 403, error: DENIED };
        }
        permittedCompanies.add(companyId);
      }
      const recordError = await authorizeRecord?.(ctx, entityType, { ...record.data, ...record, company_id: companyId });
      if (recordError) {
        await client.query('ROLLBACK');
        return { status: 403, error: recordError };
      }
    }
    if (validateOnly) {
      await client.query('ROLLBACK');
      return { status: 200, success: true, allowed: true, validated_count: uniqueIds.length };
    }
    const deleted = await client.query(`DELETE FROM ${table} WHERE ${selection} RETURNING id`, parameters);
    if (deleted.rows.length !== uniqueIds.length) throw new Error('Selected record changed during deletion.');
    await client.query('COMMIT');
    return { status: 200, success: true, deleted_ids: uniqueIds, deleted_count: uniqueIds.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { DENIED, contextError, canBulkDelete, deleteBatch };
