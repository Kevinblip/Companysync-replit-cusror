import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import translations from "@/utils/translations";

function normalizeLang(value) {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (v === 'es' || v === 'es-es' || v === 'es-mx' || v.includes('español') || v.includes('spanish')) return 'es';
  if (v === 'en' || v.includes('english')) return 'en';
  return null;
}

export function useTranslation() {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('crewcam_language') || 'en';
    } catch {
      return 'en';
    }
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['translation-company'],
    queryFn: () => base44.entities.Company.list("-created_at"),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const { data: myStaffProfiles = [] } = useQuery({
    queryKey: ['translation-staff-profile'],
    queryFn: async () => {
      try {
        const user = await base44.auth.me();
        if (!user?.email) return [];
        return await base44.entities.StaffProfile.filter({ user_email: user.email });
      } catch {
        return [];
      }
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  useEffect(() => {
    const myProfile = myStaffProfiles[0];

    if (myProfile?.preferred_language && myProfile.preferred_language !== 'inherit') {
      const personal = normalizeLang(myProfile.preferred_language);
      if (personal && personal !== lang) {
        setLang(personal);
        try { localStorage.setItem('crewcam_language', personal); } catch {}
      }
      return;
    }

    if (!companies.length) return;

    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    let company = null;

    if (impersonatedId) {
      company = companies.find(c => c.id === impersonatedId);
    }

    if (!company) {
      const ownCompanyId = myProfile?.company_id;
      if (ownCompanyId) {
        company = companies.find(c => c.id === ownCompanyId);
      }
    }

    if (!company) {
      const lastUsedId = localStorage.getItem('last_used_company_id');
      if (lastUsedId) {
        company = companies.find(c => c.id === lastUsedId);
      }
    }

    if (!company) {
      company = companies[0];
    }

    if (company?.preferred_language) {
      const companyLang = normalizeLang(company.preferred_language) || 'en';
      if (companyLang !== lang) {
        setLang(companyLang);
        try { localStorage.setItem('crewcam_language', companyLang); } catch {}
      }
    }
  }, [companies, myStaffProfiles]);

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'crewcam_language' && e.newValue) {
        const normalized = normalizeLang(e.newValue) || 'en';
        setLang(normalized);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const t = useMemo(() => {
    return translations[lang] || translations.en;
  }, [lang]);

  return { t, lang, setLang };
}

export default useTranslation;
