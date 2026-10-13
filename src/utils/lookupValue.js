// Contact fields sometimes get saved as the literal text "null" / "undefined"
// (String(null) written straight into the column by an import or an AI capture).
// Those strings are truthy, so a plain `if (lead.email)` check happily uses them
// as a real lookup key — and a junk key has been observed widening an estimate
// lookup into "every estimate with a blank email" (227 rows on a single lead).
//
// Use this before feeding any stored name/email/phone into an entity filter.
// Returns '' when the value carries no real information, so callers can skip
// the lookup entirely instead of querying for garbage.
const PLACEHOLDER_VALUES = new Set(['null', 'undefined', 'none', 'n/a', 'na', '-', '--']);

export function cleanLookupValue(value) {
  const str = (value === null || value === undefined) ? '' : String(value).trim();
  if (!str) return '';
  if (PLACEHOLDER_VALUES.has(str.toLowerCase())) return '';
  return str;
}

export default cleanLookupValue;
