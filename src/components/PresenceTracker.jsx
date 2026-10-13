import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useImpersonation } from '@/lib/ImpersonationContext';
import { getLastUsedCompanyId } from '@/lib/activeCompanySelection';

const PAGE_LABELS = {
  '/': 'Dashboard',
  '/Dashboard': 'Dashboard',
  '/Leads': 'Leads',
  '/Customers': 'Customers',
  '/Tasks': 'Tasks',
  '/Calendar': 'Calendar',
  '/Estimates': 'Estimates',
  '/Invoices': 'Invoices',
  '/Projects': 'Projects',
  '/BuildSchedule': 'Build Schedule',
  '/AIAssistant': 'Lexi AI',
  '/StaffManagement': 'Staff',
  '/GeneralSettings': 'Settings',
  '/Map': 'Map View',
  '/Reports': 'Reports',
  '/Items': 'Items / Catalog',
  '/AIEstimator': 'AI Estimator',
  '/InspectionsDashboard': 'Inspections',
  '/KnowledgeBase': 'Knowledge Base',
  '/SubcontractorManager': 'Subcontractors',
  '/BillingDashboard': 'Billing',
};

// The API considers a user online for ten minutes. Two-minute heartbeats keep
// the sidebar accurate while avoiding a database write every 30 seconds for
// every signed-in browser tab.
const HEARTBEAT_INTERVAL = 2 * 60 * 1000;

function getPageLabel(pathname) {
  const clean = pathname.replace(/\/$/, '') || '/';
  return PAGE_LABELS[clean] || clean.replace(/^\//, '').replace(/([A-Z])/g, ' $1').trim() || 'Dashboard';
}

export default function PresenceTracker() {
  const location = useLocation();
  const { isImpersonating } = useImpersonation();
  const userRef = useRef(null);
  const companyIdRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      userRef.current = u;
      companyIdRef.current = getLastUsedCompanyId(u?.email);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleCompanySwitch = (e) => {
      companyIdRef.current = e.detail?.companyId || null;
    };
    const resetForNewUser = () => {
      userRef.current = null;
      companyIdRef.current = null;
    };
    window.addEventListener('company-switched', handleCompanySwitch);
    window.addEventListener('active-company-user-changed', resetForNewUser);
    return () => {
      window.removeEventListener('company-switched', handleCompanySwitch);
      window.removeEventListener('active-company-user-changed', resetForNewUser);
    };
  }, []);

  const sendHeartbeat = async (pathname) => {
    if (isImpersonating) return;
    const user = userRef.current;
    const companyId = companyIdRef.current || getLastUsedCompanyId(user?.email);
    if (!user?.email || !companyId) return;

    try {
      await fetch('/api/local/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          user_email: user.email,
          user_name: user.name || user.email.split('@')[0],
          page: pathname,
          page_label: getPageLabel(pathname),
        }),
      });
    } catch (_) {}
  };

  useEffect(() => {
    sendHeartbeat(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      sendHeartbeat(location.pathname);
    }, HEARTBEAT_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [location.pathname, isImpersonating]);

  return null;
}
