export function getStaffEmail(staff) {
  return String(staff?.user_email || staff?.email || '').trim();
}

export function getStaffDisplayName(staff) {
  const explicitName = staff?.full_name || staff?.name;
  if (explicitName) return String(explicitName).trim();

  return [staff?.first_name, staff?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function findStaffRecipient(staffProfiles, value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (!normalizedValue) return null;

  return (staffProfiles || []).find((staff) => {
    const name = getStaffDisplayName(staff).toLowerCase();
    const email = getStaffEmail(staff).toLowerCase();
    return (staff?.is_active !== false) && (name === normalizedValue || email === normalizedValue);
  }) || null;
}

export function isValidRecipientEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}