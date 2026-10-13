import { describe, it, expect } from 'vitest'

function shouldRedirectToQuickSetup({ isDataLoading, user, myCompany, myStaffProfile }) {
  if (isDataLoading) return false;
  if (!user) return false;

  const protectedEmails = ['yicnteam@gmail.com', 'stonekevin866@gmail.com'];
  if (protectedEmails.includes(user.email)) return false;

  if (myCompany) return false;
  if (myStaffProfile) return false;

  const alreadySkipped = false;
  if (alreadySkipped) return false;

  return true;
}

describe('Quick Setup Redirect Logic', () => {
  it('does not redirect while data is loading', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: true,
      user: { email: 'new@user.com' },
      myCompany: null,
      myStaffProfile: null
    })).toBe(false);
  });

  it('does not redirect when user is null', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: null,
      myCompany: null,
      myStaffProfile: null
    })).toBe(false);
  });

  it('does not redirect platform admin', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: { email: 'yicnteam@gmail.com' },
      myCompany: null,
      myStaffProfile: null
    })).toBe(false);
  });

  it('does not redirect platform owner', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: { email: 'stonekevin866@gmail.com' },
      myCompany: null,
      myStaffProfile: null
    })).toBe(false);
  });

  it('does not redirect when user has a company', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: { email: 'someone@test.com' },
      myCompany: { id: 'comp-1', company_name: 'Test Co' },
      myStaffProfile: null
    })).toBe(false);
  });

  it('does not redirect when user has a staff profile', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: { email: 'someone@test.com' },
      myCompany: null,
      myStaffProfile: { company_id: 'comp-1', role: 'sales' }
    })).toBe(false);
  });

  it('redirects new user with no company and no profile after data loads', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: { email: 'brand-new@user.com' },
      myCompany: null,
      myStaffProfile: null
    })).toBe(true);
  });

  it('critical: does not redirect platform admin even if data returns no company temporarily', () => {
    expect(shouldRedirectToQuickSetup({
      isDataLoading: false,
      user: { email: 'yicnteam@gmail.com' },
      myCompany: null,
      myStaffProfile: null
    })).toBe(false);
  });
});
