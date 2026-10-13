import { describe, it, expect } from 'vitest'
import {
  ACTIVE_COMPANY_USER_KEY,
  LEGACY_LAST_USED_COMPANY_KEY,
  PLATFORM_COMPANY_ID,
  activateCompanySelectionUser,
  companySelectionKey,
  getDefaultCompanyId,
  getLastUsedCompanyId,
  getPreferredCompanyId,
  hasCrossTenantCompanyAccess,
  resolveActiveCompanyId,
  setLastUsedCompanyId,
} from '../lib/activeCompanySelection'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

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
  it('keeps an explicit company selection scoped to the signed-in user', () => {
    const storage = memoryStorage({
      [ACTIVE_COMPANY_USER_KEY]: 'kevin@companysync.com',
    });
    setLastUsedCompanyId('yicn-id', 'kevin@companysync.com', storage);

    expect(getLastUsedCompanyId('kevin@companysync.com', storage)).toBe('yicn-id');
    expect(getLastUsedCompanyId('other@companysync.com', storage)).toBeNull();
  });

  it('ignores the old browser-wide company value', () => {
    const storage = memoryStorage({
      [ACTIVE_COMPANY_USER_KEY]: 'companysync@owner.com',
      [LEGACY_LAST_USED_COMPANY_KEY]: 'yicn-id',
    });

    expect(getLastUsedCompanyId('companysync@owner.com', storage)).toBeNull();
  });

  it('drops the legacy selection when a different account authenticates', () => {
    const storage = memoryStorage({
      [ACTIVE_COMPANY_USER_KEY]: 'old-owner@example.com',
      [LEGACY_LAST_USED_COMPANY_KEY]: 'yicn-id',
    });

    activateCompanySelectionUser('companysync-owner@example.com', storage);

    expect(storage.getItem(ACTIVE_COMPANY_USER_KEY)).toBe('companysync-owner@example.com');
    expect(storage.getItem(LEGACY_LAST_USED_COMPANY_KEY)).toBeNull();
    expect(companySelectionKey('old-owner@example.com')).not.toBe(companySelectionKey('companysync-owner@example.com'));
  });

  it('defaults a CompanySync member to CompanySync even when they own YICN', () => {
    const profiles = [{ company_id: 'companysync_master_001', is_administrator: true }];
    const ownedCompanies = [{ id: 'yicn-id', company_name: 'YICN Roofing' }];

    expect(getDefaultCompanyId({ profiles, ownedCompanies })).toBe('companysync_master_001');
    expect(resolveActiveCompanyId({ profiles, ownedCompanies })).toBe('companysync_master_001');
  });

  it('retains an explicit same-user YICN switch over the safe CompanySync default', () => {
    const profiles = [{ company_id: 'companysync_master_001', is_administrator: true }];
    const ownedCompanies = [{ id: 'yicn-id', company_name: 'YICN Roofing' }];

    expect(resolveActiveCompanyId({
      profiles,
      ownedCompanies,
      selectedCompanyId: 'yicn-id',
    })).toBe('yicn-id');
  });

  it('reads a platform staff preferred company without changing company ownership', () => {
    const profiles = [{
      company_id: PLATFORM_COMPANY_ID,
      data: { preferred_company_id: 'live-yicn-id' },
    }];

    expect(getPreferredCompanyId(profiles)).toBe('live-yicn-id');
    expect(resolveActiveCompanyId({
      selectedCompanyId: getPreferredCompanyId(profiles),
      profiles,
      isPlatformAdmin: true,
    })).toBe('live-yicn-id');
  });

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

  // The shell and the data layer both call resolveActiveCompanyId. When they
  // disagree the sidebar brands one tenant while the dashboard reads another,
  // which is how a platform admin saw YICN branding over another company's
  // (empty) dashboard.
  describe('platform admin tenant switching', () => {
    const superAdmin = { email: 'admin@companysync.com', platform_role: 'super_admin' }
    const tenantUser = { email: 'rep@yicn.com', platform_role: null }

    it('recognizes only accounts the API serves cross-tenant data to', () => {
      expect(hasCrossTenantCompanyAccess({ user: superAdmin })).toBe(true)
      expect(hasCrossTenantCompanyAccess({ user: { email: 'a@b.c', company_id: PLATFORM_COMPANY_ID } })).toBe(true)
      expect(hasCrossTenantCompanyAccess({
        user: tenantUser,
        profiles: [{ company_id: PLATFORM_COMPANY_ID, is_super_admin: true }],
      })).toBe(true)
      // A plain staff row at the platform company is not cross-tenant access —
      // the API still scopes those reads.
      expect(hasCrossTenantCompanyAccess({
        user: tenantUser,
        profiles: [{ company_id: PLATFORM_COMPANY_ID }],
      })).toBe(false)
      expect(hasCrossTenantCompanyAccess({ user: tenantUser, profiles: [{ company_id: 'yicn-id' }] })).toBe(false)
      expect(hasCrossTenantCompanyAccess({ user: null })).toBe(false)
    })

    it('honors a platform admin selecting a tenant they have no membership in', () => {
      expect(resolveActiveCompanyId({
        selectedCompanyId: 'yicn-id',
        profiles: [{ company_id: 'sedgwick-id', is_administrator: true }],
        ownedCompanies: [],
        isPlatformAdmin: true,
      })).toBe('yicn-id')
    })

    it('still ignores a foreign selection for a normal tenant user', () => {
      expect(resolveActiveCompanyId({
        selectedCompanyId: 'yicn-id',
        profiles: [{ company_id: 'sedgwick-id', is_administrator: true }],
        ownedCompanies: [],
        isPlatformAdmin: false,
      })).toBe('sedgwick-id')
    })

    it('sends a platform admin home to CompanySync instead of a stray tenant profile', () => {
      expect(getDefaultCompanyId({
        profiles: [{ company_id: 'sedgwick-id', is_administrator: true }],
        ownedCompanies: [],
        isPlatformAdmin: true,
      })).toBe(PLATFORM_COMPANY_ID)
    })

    it('keeps an owner on their own company even with platform access', () => {
      expect(getDefaultCompanyId({
        profiles: [{ company_id: 'owned-co' }],
        ownedCompanies: [{ id: 'owned-co' }],
        isPlatformAdmin: true,
      })).toBe('owned-co')
    })

    it('lets an active impersonation outrank any stored selection', () => {
      expect(resolveActiveCompanyId({
        impersonatedId: 'yicn-id',
        selectedCompanyId: 'sedgwick-id',
        profiles: [{ company_id: 'sedgwick-id' }],
        ownedCompanies: [],
        isPlatformAdmin: true,
      })).toBe('yicn-id')
    })
  })

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
