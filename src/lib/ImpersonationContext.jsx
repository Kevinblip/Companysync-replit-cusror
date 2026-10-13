import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clearLastUsedCompanyId, getLastUsedCompanyId, setLastUsedCompanyId } from '@/lib/activeCompanySelection';

const ImpersonationContext = createContext(null);

// Fired after the tab reconciles its impersonation state with the server
// session, so hooks that read sessionStorage directly can recompute.
export const IMPERSONATION_SYNCED_EVENT = 'impersonation-session-synced';

const IMPERSONATION_SESSION_KEYS = [
  'impersonating_company_id',
  'impersonating_company_name',
  'impersonation_session_id',
  'impersonation_expires_at',
  'view_as_user_email',
  'view_as_user_name',
];

function readSessionStorage() {
  if (typeof window === 'undefined') return null;
  const companyId = sessionStorage.getItem('impersonating_company_id');
  if (!companyId) return null;
  return {
    companyId,
    companyName: sessionStorage.getItem('impersonating_company_name') || 'Unknown',
    sessionId: sessionStorage.getItem('impersonation_session_id') || null,
    expiresAt: sessionStorage.getItem('impersonation_expires_at') || null,
    viewAsUserEmail: sessionStorage.getItem('view_as_user_email') || null,
    viewAsUserName: sessionStorage.getItem('view_as_user_name') || null,
  };
}

export function ImpersonationProvider({ children }) {
  const [impersonation, setImpersonation] = useState(readSessionStorage);
  const queryClient = useQueryClient();
  const stopInFlightRef = useRef(null);
  const directSelectionPendingRef = useRef(false);
  // Bumped by every start/stop so a slower server-status reconciliation can
  // tell that its answer is older than the current impersonation state.
  const sessionOpRef = useRef(0);

  const markDirectCompanySelection = useCallback(() => {
    // A timeout may have already cleared React state while its server stop is
    // still pending. Marking this intent independently lets a direct switch
    // override that pending default restoration even after the banner vanishes.
    if (stopInFlightRef.current) {
      directSelectionPendingRef.current = true;
      return stopInFlightRef.current;
    }
    return null;
  }, []);

  const startImpersonation = useCallback(async ({ companyId, companyName, adminEmail, reason }) => {
    // Invalidate any status reconciliation already in flight: its answer
    // predates this transition, and applying it would clear a session that was
    // just started (leaving the server impersonating while the UI is not).
    sessionOpRef.current += 1;
    let sessionId = null;
    const resp = await fetch('/api/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_company_id: companyId,
        target_company_name: companyName,
        reason: reason || 'Support session',
        duration_hours: 0.5,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to start impersonation session');
    }
    const result = await resp.json();
    sessionId = result.log_id || null;

    const previouslySelectedCompanyId = getLastUsedCompanyId(adminEmail);
    if (previouslySelectedCompanyId && previouslySelectedCompanyId !== companyId) {
      sessionStorage.setItem('pre_impersonation_company_id', previouslySelectedCompanyId);
      sessionStorage.setItem('pre_impersonation_user_email', adminEmail || '');
    }
    // The impersonated tenant is deliberately NOT written to the persistent
    // per-user selection. That selection outlives the session (it is shared by
    // every tab and survives expiry), and a tenant left there keeps branding
    // the shell long after the server has stopped serving that tenant's data.
    sessionStorage.setItem('impersonating_company_id', companyId);
    sessionStorage.setItem('impersonating_company_name', companyName);
    if (sessionId) sessionStorage.setItem('impersonation_session_id', String(sessionId));
    if (result.expires_at) sessionStorage.setItem('impersonation_expires_at', result.expires_at);
    sessionStorage.removeItem('view_as_user_email');
    sessionStorage.removeItem('view_as_user_name');

    const data = {
      companyId,
      companyName,
      sessionId: sessionId ? String(sessionId) : null,
      expiresAt: result.expires_at || null,
      viewAsUserEmail: null,
      viewAsUserName: null,
    };
    setImpersonation(data);

    window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId } }));
    queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['company-hierarchy'] });
  }, [queryClient]);

  const stopImpersonation = useCallback(async ({ restoreSelection = true } = {}) => {
    // A direct company choice always supersedes a simultaneous expiry/banner
    // stop. Mark it before checking the in-flight promise so that a stop which
    // began first cannot restore the old tenant after the new choice is made.
    if (!restoreSelection) directSelectionPendingRef.current = true;
    // See startImpersonation: a status response from before this stop must not
    // be applied afterwards.
    sessionOpRef.current += 1;

    // Expiry, the banner, and a company-switch click can all request a stop.
    // They must share one transition so a later caller cannot restore/erase a
    // company selection chosen by the first caller.
    if (stopInFlightRef.current) return stopInFlightRef.current;

    // Clear local impersonation state before waiting for the server. This keeps
    // the shell and request client from treating the old tenant as active while
    // a deliberate company switch is in progress.
    const activeSession = readSessionStorage();
    const previousCompanyId = sessionStorage.getItem('pre_impersonation_company_id');
    const previousCompanyUserEmail = sessionStorage.getItem('pre_impersonation_user_email');
    sessionStorage.removeItem('impersonating_company_id');
    sessionStorage.removeItem('impersonating_company_name');
    sessionStorage.removeItem('impersonation_session_id');
    sessionStorage.removeItem('impersonation_expires_at');
    sessionStorage.removeItem('view_as_user_email');
    sessionStorage.removeItem('view_as_user_name');

    sessionStorage.removeItem('pre_impersonation_company_id');
    sessionStorage.removeItem('pre_impersonation_user_email');
    setImpersonation(null);
    const stopRequest = (async () => {
      try {
        const response = await fetch('/api/impersonation/stop', { method: 'POST' });
        if (!response.ok) throw new Error(`Server rejected impersonation stop (${response.status})`);

        if (restoreSelection && !directSelectionPendingRef.current && previousCompanyId && previousCompanyUserEmail) {
          setLastUsedCompanyId(previousCompanyId, previousCompanyUserEmail);
        } else if (restoreSelection && !directSelectionPendingRef.current) {
          clearLastUsedCompanyId();
        }

        window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId: null } }));
        queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['company-hierarchy'] });
      } catch (err) {
        // Do not reload into a claimed non-impersonating state when the server
        // still has the session. Restore the local context so it matches.
        if (activeSession) {
          sessionStorage.setItem('impersonating_company_id', activeSession.companyId);
          sessionStorage.setItem('impersonating_company_name', activeSession.companyName);
          if (activeSession.sessionId) sessionStorage.setItem('impersonation_session_id', activeSession.sessionId);
          if (activeSession.expiresAt) sessionStorage.setItem('impersonation_expires_at', activeSession.expiresAt);
          if (activeSession.viewAsUserEmail) sessionStorage.setItem('view_as_user_email', activeSession.viewAsUserEmail);
          if (activeSession.viewAsUserName) sessionStorage.setItem('view_as_user_name', activeSession.viewAsUserName);
          if (previousCompanyId && previousCompanyUserEmail) {
            sessionStorage.setItem('pre_impersonation_company_id', previousCompanyId);
            sessionStorage.setItem('pre_impersonation_user_email', previousCompanyUserEmail);
          }
          setImpersonation(activeSession);
          window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId: activeSession.companyId } }));
        }
        throw err;
      }
    })();

    stopInFlightRef.current = stopRequest.finally(() => {
      stopInFlightRef.current = null;
      directSelectionPendingRef.current = false;
    });
    return stopInFlightRef.current;
  }, [queryClient]);

  const startViewAsUser = useCallback(({ userEmail, userName }) => {
    sessionStorage.setItem('view_as_user_email', userEmail);
    sessionStorage.setItem('view_as_user_name', userName || userEmail);
    setImpersonation(prev => prev ? { ...prev, viewAsUserEmail: userEmail, viewAsUserName: userName || userEmail } : prev);
    // Persist to audit log row (fire-and-forget)
    fetch('/api/impersonation/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: userEmail }),
    }).catch(e => console.warn('[Impersonation] view-as log update failed:', e.message));
    queryClient.invalidateQueries();
  }, [queryClient]);

  const stopViewAsUser = useCallback(() => {
    sessionStorage.removeItem('view_as_user_email');
    sessionStorage.removeItem('view_as_user_name');
    setImpersonation(prev => prev ? { ...prev, viewAsUserEmail: null, viewAsUserName: null } : prev);
    queryClient.invalidateQueries();
  }, [queryClient]);

  // The session cookie — not this browser tab — decides whether an
  // impersonation is active. sessionStorage is per-tab and is lost on a new
  // tab, so reconcile once on mount: adopt a server session this tab does not
  // know about, and drop a tab-local session the server has already ended.
  // Without this the shell brands one tenant while the data layer resolves
  // another.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const generation = sessionOpRef.current;
      try {
        const resp = await fetch('/api/impersonation/status', { credentials: 'include' });
        if (!resp.ok) return; // unauthenticated or offline — keep local state
        const status = await resp.json();
        // A start/stop that happened while this was in flight is newer than
        // this answer; applying it now would undo that transition.
        if (cancelled || stopInFlightRef.current || sessionOpRef.current !== generation) return;

        const local = readSessionStorage();
        if (status?.active && status.company_id) {
          if (local?.companyId === status.company_id) return;
          sessionStorage.setItem('impersonating_company_id', status.company_id);
          sessionStorage.setItem('impersonating_company_name', status.company_name || 'Unknown');
          if (status.expires_at) sessionStorage.setItem('impersonation_expires_at', status.expires_at);
          else sessionStorage.removeItem('impersonation_expires_at');
          setImpersonation(readSessionStorage());
        } else if (local) {
          IMPERSONATION_SESSION_KEYS.forEach((key) => sessionStorage.removeItem(key));
          setImpersonation(null);
        } else {
          return;
        }

        window.dispatchEvent(new CustomEvent(IMPERSONATION_SYNCED_EVENT));
        window.dispatchEvent(new CustomEvent('company-switched', {
          detail: { companyId: status?.active ? status.company_id : null },
        }));
        queryClient.invalidateQueries();
      } catch (_) {
        // Network failure: never guess. Leaving local state untouched keeps the
        // shell and the data layer consistent with each other.
      }
    })();
    return () => { cancelled = true; };
  }, [queryClient]);

  // Auto-stop when the 30-minute server-side session expires
  useEffect(() => {
    if (!impersonation?.expiresAt) return;
    const msUntilExpiry = new Date(impersonation.expiresAt).getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      stopImpersonation();
      return;
    }
    const t = setTimeout(() => stopImpersonation(), msUntilExpiry);
    return () => clearTimeout(t);
  }, [impersonation?.expiresAt, stopImpersonation]);

  // Auth may change accounts without unmounting this provider. Storage alone is
  // not enough: this state was initialized from the old session and would keep
  // exposing the old tenant to Layout after the storage key was cleared.
  useEffect(() => {
    const resetForNewUser = () => setImpersonation(null);
    window.addEventListener('active-company-user-changed', resetForNewUser);
    return () => window.removeEventListener('active-company-user-changed', resetForNewUser);
  }, []);

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
    markDirectCompanySelection,
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
