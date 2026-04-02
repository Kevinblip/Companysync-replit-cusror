import { describe, it, expect } from 'vitest'

function selectTargetCompanyId({ myProfiles, profileCompanies, ownedCompanies, impersonatedId }) {
  if (impersonatedId) return impersonatedId;

  if (myProfiles.length > 1 && profileCompanies.length > 0) {
    const nonPlatformCompany = profileCompanies.find(c =>
      c.company_name !== 'CompanySync' && !c.is_platform_owner
    );
    if (nonPlatformCompany) return nonPlatformCompany.id;
  }

  const myStaffProfile = myProfiles[0];
  if (myStaffProfile?.company_id) {
    return myStaffProfile.company_id;
  }

  if (ownedCompanies.length > 1) {
    const nonPlatform = ownedCompanies.find(c =>
      c.company_name !== 'CompanySync' && !c.is_platform_owner
    );
    if (nonPlatform) return nonPlatform.id;
  }
  return ownedCompanies[0]?.id;
}

describe('Company Selection Logic', () => {
  it('returns impersonated company when set', () => {
    const result = selectTargetCompanyId({
      myProfiles: [{ company_id: 'comp-1' }],
      profileCompanies: [],
      ownedCompanies: [],
      impersonatedId: 'impersonated-123'
    });
    expect(result).toBe('impersonated-123');
  });

  it('selects non-CompanySync when user has multiple profiles', () => {
    const result = selectTargetCompanyId({
      myProfiles: [
        { company_id: 'companysync-id' },
        { company_id: 'client-id' }
      ],
      profileCompanies: [
        { id: 'companysync-id', company_name: 'CompanySync' },
        { id: 'client-id', company_name: 'Acme Roofing' }
      ],
      ownedCompanies: [],
      impersonatedId: null
    });
    expect(result).toBe('client-id');
  });

  it('selects CompanySync when it is the only profile', () => {
    const result = selectTargetCompanyId({
      myProfiles: [{ company_id: 'companysync-id' }],
      profileCompanies: [],
      ownedCompanies: [],
      impersonatedId: null
    });
    expect(result).toBe('companysync-id');
  });

  it('selects non-platform owned company when multiple owned', () => {
    const result = selectTargetCompanyId({
      myProfiles: [],
      profileCompanies: [],
      ownedCompanies: [
        { id: 'companysync-id', company_name: 'CompanySync' },
        { id: 'real-co-id', company_name: 'Real Roofing Co' }
      ],
      impersonatedId: null
    });
    expect(result).toBe('real-co-id');
  });

  it('falls back to first owned company when only one exists', () => {
    const result = selectTargetCompanyId({
      myProfiles: [],
      profileCompanies: [],
      ownedCompanies: [{ id: 'only-co', company_name: 'Solo Roofing' }],
      impersonatedId: null
    });
    expect(result).toBe('only-co');
  });

  it('returns undefined when no profiles and no owned companies', () => {
    const result = selectTargetCompanyId({
      myProfiles: [],
      profileCompanies: [],
      ownedCompanies: [],
      impersonatedId: null
    });
    expect(result).toBeUndefined();
  });

  it('skips companies with is_platform_owner flag', () => {
    const result = selectTargetCompanyId({
      myProfiles: [
        { company_id: 'platform-id' },
        { company_id: 'client-id' }
      ],
      profileCompanies: [
        { id: 'platform-id', company_name: 'MyPlatform', is_platform_owner: true },
        { id: 'client-id', company_name: 'Client Co' }
      ],
      ownedCompanies: [],
      impersonatedId: null
    });
    expect(result).toBe('client-id');
  });

  it('impersonation overrides everything including multi-profile selection', () => {
    const result = selectTargetCompanyId({
      myProfiles: [
        { company_id: 'companysync-id' },
        { company_id: 'client-id' }
      ],
      profileCompanies: [
        { id: 'companysync-id', company_name: 'CompanySync' },
        { id: 'client-id', company_name: 'Acme Roofing' }
      ],
      ownedCompanies: [],
      impersonatedId: 'override-co'
    });
    expect(result).toBe('override-co');
  });

  it('prefers staff profile over owned company', () => {
    const result = selectTargetCompanyId({
      myProfiles: [{ company_id: 'staff-co' }],
      profileCompanies: [],
      ownedCompanies: [{ id: 'owned-co', company_name: 'Owned Co' }],
      impersonatedId: null
    });
    expect(result).toBe('staff-co');
  });
});
