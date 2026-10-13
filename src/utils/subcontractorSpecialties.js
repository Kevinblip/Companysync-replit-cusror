export const DEFAULT_SUBCONTRACTOR_SPECIALTIES = [
  'Roofing', 'Siding', 'Windows', 'Doors', 'Gutters', 'HVAC',
  'Plumbing', 'Electrical', 'Painting', 'Flooring',
];

// Saved specialties are the company-scoped source of reusable custom choices.
export function getSpecialtyOptions(subcontractors = [], selected = []) {
  const seen = new Set();
  return [
    ...DEFAULT_SUBCONTRACTOR_SPECIALTIES,
    ...subcontractors.flatMap(sub => Array.isArray(sub.specialty) ? sub.specialty : []),
    ...(Array.isArray(selected) ? selected : []),
  ].flatMap(value => {
    if (typeof value !== 'string') return [];
    const name = value.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}