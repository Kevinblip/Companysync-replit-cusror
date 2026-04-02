import { useMemo, useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useImpersonation } from "@/lib/ImpersonationContext";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";

const LAST_USED_KEY = 'last_used_company_id';

export default function useCurrentCompany(user) {
  const queryClient = useQueryClient();
  const [autoProvisionDone, setAutoProvisionDone] = useState(false);
  const provisioningRef = useRef(false);
  const { impersonatedCompanyId: impersonatedId } = useImpersonation();

  const lastUsedId = typeof window !== 'undefined'
    ? localStorage.getItem(LAST_USED_KEY)
    : null;

  // My own staff profile(s) — used to determine which company this user belongs to
  const { data: staffProfiles = [], isFetched: profilesFetched } = useQuery({
    queryKey: ['current-company-staff', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  // Companies owned by the current user — fallback when no staff profile exists
  const { data: ownedCompanies = [] } = useQuery({
    queryKey: ['owned-companies-hook', user?.email],
    queryFn: () => user ? base44.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } }) : [],
    enabled: !!user,
    initialData: [],
    staleTime: 30000,
  });

  const targetCompanyId = useMemo(() => {
    if (impersonatedId) return impersonatedId;
    if (lastUsedId) {
      const hasProfile = staffProfiles.some(p => p.company_id === lastUsedId);
      const isOwned = ownedCompanies.some(c => c.id === lastUsedId);
      if (hasProfile || isOwned || staffProfiles.length === 0) return lastUsedId;
    }
    // Prefer staff profile company
    const sorted = [...staffProfiles].sort((a, b) =>
      new Date(b.created_at || b.created_date || 0) - new Date(a.created_at || a.created_date || 0)
    );
    if (sorted[0]?.company_id) return sorted[0].company_id;
    // Fallback: owned company (company where created_by = user.email)
    return ownedCompanies[0]?.id || null;
  }, [impersonatedId, lastUsedId, staffProfiles, ownedCompanies]);

  const { data: targetCompanyArr = [] } = useQuery({
    queryKey: ['target-company', targetCompanyId],
    queryFn: async () => {
      if (!targetCompanyId) return [];
      const results = await base44.entities.Company.filter({ id: targetCompanyId });
      return Array.isArray(results) ? results : [];
    },
    enabled: !!targetCompanyId,
    staleTime: 30000,
  });

  const company = targetCompanyArr[0] || null;

  // All staff profiles for the resolved company — used for dropdowns, assignments, etc.
  const { data: allCompanyStaff = [] } = useQuery({
    queryKey: ['all-company-staff', targetCompanyId],
    queryFn: () => targetCompanyId ? base44.entities.StaffProfile.filter({ company_id: targetCompanyId }) : [],
    enabled: !!targetCompanyId,
    initialData: [],
  });

  const { data: allCompanies = [], isLoading: isLoadingAll, isFetched: allCompaniesFetched } = useQuery({
    queryKey: ['current-company-list', user?.email],
    queryFn: async () => {
      if (!user) return [];
      try {
        const owned = await base44.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } });
        const companyIds = staffProfiles.map(p => p.company_id).filter(Boolean);
        let staffed = [];
        if (companyIds.length > 0) {
          const results = await Promise.all(companyIds.map(id => base44.entities.Company.filter({ id })));
          staffed = results.flat();
        }
        const all = [...owned, ...staffed];
        if (isPlatformAdminCheck(user, null, null)) {
          try {
            const adminAll = await base44.entities.Company.filter({ is_deleted: { $ne: true } });
            for (const c of adminAll) {
              if (!all.find(e => e.id === c.id)) all.push(c);
            }
          } catch (e) {
            console.warn('[useCurrentCompany] Admin company fetch failed:', e.message);
          }
        }
        return Array.from(new Map(all.map(item => [item.id, item])).values());
      } catch (err) {
        console.error('[useCurrentCompany] Companies fetch failed:', err);
        return [];
      }
    },
    enabled: !!user && profilesFetched,
    staleTime: 30000,
  });

  const companies = useMemo(() => {
    const list = [...allCompanies];
    if (company && !list.find(c => c.id === company.id)) {
      list.unshift(company);
    }
    return list;
  }, [allCompanies, company]);

  useEffect(() => {
    if (!user || !allCompaniesFetched || provisioningRef.current || autoProvisionDone) return;
    if (allCompanies.length > 0 || staffProfiles.length > 0) return;

    provisioningRef.current = true;

    (async () => {
      try {
        const resp = await fetch('/api/local/auto-provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            name: user.name || user.email.split('@')[0],
          }),
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.company?.id) {
            localStorage.setItem(LAST_USED_KEY, result.company.id);
          }
          queryClient.invalidateQueries({ queryKey: ['current-company-list'] });
          queryClient.invalidateQueries({ queryKey: ['current-company-staff'] });
        }
      } catch (err) {
        console.error('[useCurrentCompany] Auto-provision failed:', err);
      } finally {
        setAutoProvisionDone(true);
        provisioningRef.current = false;
      }
    })();
  }, [user, allCompaniesFetched, allCompanies.length, staffProfiles.length, autoProvisionDone, queryClient]);

  useEffect(() => {
    if (company?.id && !impersonatedId) {
      localStorage.setItem(LAST_USED_KEY, company.id);
    }
  }, [company?.id, impersonatedId]);

  return useMemo(() => ({
    company,
    companies,
    staffProfiles,          // Current user's own profile(s) — do NOT use for dropdowns
    allCompanyStaff,        // ALL staff for the company — use this for dropdowns & assignments
    isLoading: !company && !!targetCompanyId,
    isImpersonating: !!impersonatedId,
  }), [company, companies, staffProfiles, allCompanyStaff, targetCompanyId, impersonatedId]);
}
