export function resolveCustomerCompanyId(company, selectedCompanyId) {
  return company?.id || selectedCompanyId || null;
}

export function normalizeAssignmentStaff(profiles = []) {
  const seen = new Set();
  return profiles.flatMap(profile => {
    const data = profile.data && typeof profile.data === 'object' ? profile.data : {};
    const email = [profile.user_email, profile.email, data.user_email, data.email]
      .find(value => typeof value === 'string' && value.trim())?.trim().toLowerCase();
    if (!email || seen.has(email)) return [];
    seen.add(email);
    return [{
      ...profile,
      user_email: email,
      full_name: profile.full_name || profile.name || data.full_name || data.name || email,
    }];
  });
}
