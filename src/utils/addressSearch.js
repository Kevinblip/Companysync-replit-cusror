const ADDRESS_FIELDS = [
  'property_address',
  'address',
  'street',
  'address_line_1',
  'address_line_2',
  'city',
  'state',
  'zip',
  'postal_code',
];

function flattenRecord(record) {
  if (!record || typeof record !== 'object') return {};
  const nested = record.data && typeof record.data === 'object' ? record.data : {};
  return { ...nested, ...record };
}

/**
 * Builds a searchable address string from one or more related records.
 * This intentionally keeps the original address tokens separated so a
 * partial search such as "1367 shawview" matches "1367 Shawview Lane".
 */
export function getAddressSearchText(...records) {
  const values = [];
  for (const record of records) {
    const source = flattenRecord(record);
    for (const field of ADDRESS_FIELDS) {
      const value = source[field];
      if (value !== null && value !== undefined && String(value).trim()) {
        values.push(String(value).trim());
      }
    }
    if (source._address_search) values.push(String(source._address_search));
  }
  return [...new Set(values)].join(' ').toLowerCase();
}

export function matchesAddressSearch(record, searchTerm, ...relatedRecords) {
  const query = String(searchTerm || '').trim().toLowerCase();
  return !query || getAddressSearchText(record, ...relatedRecords).includes(query);
}