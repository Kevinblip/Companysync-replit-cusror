'use strict';

// invoice_id and customer_id are real columns, and older rows also keep them
// inside payments.data. A filter on the column alone misses a local_ invoice
// id that was stored only in data, so the balance (which reads both) moves
// while the invoice Payments tab stays empty.

const MIRRORED_ID_COLUMNS = new Set(['invoice_id', 'customer_id']);

function mirroredIdEquality(columnName, placeholder, { hasDataColumn = false } = {}) {
  if (!hasDataColumn || !MIRRORED_ID_COLUMNS.has(columnName)) {
    return { sql: `"${columnName}" = ${placeholder}`, asText: false };
  }
  return {
    sql: `(COALESCE(NULLIF(BTRIM("${columnName}"::text), ''), data->>'${columnName}') = ${placeholder})`,
    asText: true,
  };
}

module.exports = {
  MIRRORED_ID_COLUMNS,
  mirroredIdEquality,
};
