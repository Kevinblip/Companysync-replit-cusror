// The phone receptionist is stored as assistant_name "sarah". That value is an
// internal id. Screens should say Alex unless a company set a custom name.
export function receptionistDisplayName(assistantName) {
  const raw = String(assistantName || '').trim();
  if (!raw || raw.toLowerCase() === 'sarah') return 'Alex';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
