import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const ImpersonationContext = createContext(null);

function readSessionStorage() {
  if (typeof window === 'undefined') return null;
  const companyId = sessionStorage.getItem('impersonating_company_id');
  if (!companyId) return null;
  return {
    companyId,
    companyName: sessionStorage.getItem('impersonating_company_name') || 'Unknown',
    sessionId: sessionStorage.getItem('impersonation_session_id') || null,
    viewAsUserEmail: sessionStorage.getItem('view_as_user_email') || null,
    viewAsUserName: sessionStorage.getItem('view_as_user_name') || null,
  };
}

export function ImpersonationProvider({ children }) {
  const [impersonation, setImpersonation] = useState(readSessionStorage);
  const queryClient = useQueryClient();

  const startImpersonation = useCallback(async ({ companyId, companyName, adminEmail }) => {
    let sessionId = null;
    try {
      const logEntry = await base44.entities.ImpersonationLog.create({
        admin_email: adminEmail,
        target_company_id: companyId,
        target_company_name: companyName,
        started_at: new Date().toISOString(),
        is_active: true,
      });
      sessionId = logEntry?.id || null;
    } catch (err) {
      console.error('Failed to create impersonation log:', err);
    }

    sessionStorage.setItem('impersonating_company_id', companyId);
    sessionStorage.setItem('impersonating_company_name', companyName);
    if (sessionId) sessionStorage.setItem('impersonation_session_id', String(sessionId));
    sessionStorage.removeItem('view_as_user_email');
    sessionStorage.removeItem('view_as_user_name');
    
    localStorage.setItem('last_used_company_id', companyId);

    const data = { companyId, companyName, sessionId: sessionId ? String(sessionId) : null, viewAsUserEmail: null, viewAsUserName: null };
    setImpersonation(data);

    window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId } }));
    queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['company-hierarchy'] });
  }, [queryClient]);

  const stopImpersonation = useCallback(async () => {
    const sessionId = impersonation?.sessionId;

    if (sessionId) {
      try {
        const log = await base44.entities.ImpersonationLog.filter({ id: sessionId });
        if (log.length > 0) {
          const startedAt = new Date(log[0].started_at);
          const endedAt = new Date();
          const durationMinutes = Math.round((endedAt - startedAt) / 1000 / 60);
          await base44.entities.ImpersonationLog.update(sessionId, {
            ended_at: endedAt.toISOString(),
            duration_minutes: durationMinutes,
            is_active: false,
          });
        }
      } catch (err) {
        console.error('Failed to update impersonation log:', err);
      }
    }

    sessionStorage.removeItem('impersonating_company_id');
    sessionStorage.removeItem('impersonating_company_name');
    sessionStorage.removeItem('impersonation_session_id');
    sessionStorage.removeItem('view_as_user_email');
    sessionStorage.removeItem('view_as_user_name');

    localStorage.removeItem('last_used_company_id');

    setImpersonation(null);
    window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId: null } }));

    queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['company-hierarchy'] });
  }, [impersonation, queryClient]);

  const startViewAsUser = useCallback(({ userEmail, userName }) => {
    sessionStorage.setItem('view_as_user_email', userEmail);
    sessionStorage.setItem('view_as_user_name', userName || userEmail);
    setImpersonation(prev => prev ? { ...prev, viewAsUserEmail: userEmail, viewAsUserName: userName || userEmail } : prev);
    queryClient.invalidateQueries();
  }, [queryClient]);

  const stopViewAsUser = useCallback(() => {
    sessionStorage.removeItem('view_as_user_email');
    sessionStorage.removeItem('view_as_user_name');
    setImpersonation(prev => prev ? { ...prev, viewAsUserEmail: null, viewAsUserName: null } : prev);
    queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo(() => ({
    isImpersonating: !!impersonation,
    impersonatedCompanyId: impersonation?.companyId || null,
    impersonatedCompanyName: impersonation?.companyName || null,
    impersonationSessionId: impersonation?.sessionId || null,
    impersonationData: impersonation,
    viewAsUserEmail: impersonation?.viewAsUserEmail || null,
    viewAsUserName: impersonation?.viewAsUserName || null,
    isViewingAsUser: !!(impersonation?.viewAsUserEmail),
    startImpersonation,
    stopImpersonation,
    startViewAsUser,
    stopViewAsUser,
  }), [impersonation, startImpersonation, stopImpersonation, startViewAsUser, stopViewAsUser]);

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) {
    throw new Error('useImpersonation must be used within ImpersonationProvider');
  }
  return ctx;
}
