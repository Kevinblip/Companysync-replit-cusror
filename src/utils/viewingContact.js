const STORAGE_KEY = 'companysync.viewingContact';
const TTL_MS = 30 * 60 * 1000;

export function setViewingContact(contact) {
  if (!contact) return;
  const payload = {
    phone: contact.phone || '',
    customerId: contact.customerId || contact.customer_id || '',
    leadId: contact.leadId || contact.lead_id || '',
    name: contact.name || '',
    companyId: contact.companyId || '',
    at: Date.now(),
  };
  if (!payload.phone && !payload.customerId && !payload.leadId) return;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
}

export function getViewingContact() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || Date.now() - parsed.at > TTL_MS) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function viewingContactPayload(companyId) {
  const params = new URLSearchParams(window.location.search);
  const explicit = {
    phone: params.get('phone') || '',
    customerId: params.get('customerId') || params.get('customer_id') || '',
    leadId: params.get('leadId') || params.get('lead_id') || '',
  };
  const stored = getViewingContact();
  const storedMatchesCompany = stored && (!companyId || !stored.companyId || stored.companyId === companyId);
  const contact = {
    phone: explicit.phone || (storedMatchesCompany ? stored.phone : '') || '',
    customerId: explicit.customerId || (storedMatchesCompany ? stored.customerId : '') || '',
    leadId: explicit.leadId || (storedMatchesCompany ? stored.leadId : '') || '',
  };
  if (!contact.phone && !contact.customerId && !contact.leadId) return undefined;
  return contact;
}
