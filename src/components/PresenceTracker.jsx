import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useImpersonation } from '@/lib/ImpersonationContext';

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

function getPageLabel(pathname) {
  const clean = pathname.replace(/\/$/, '') || '/';
  return PAGE_LABELS[clean] || clean.replace(/^\//, '').replace(/([A-Z])/g, ' $1').trim() || 'Dashboard';
}

const HEARTBEAT_INTERVAL = 30000;

export default function PresenceTracker() {
  const location = useLocation();
  const { isImpersonating } = useImpersonation();
  const userRef = useRef(null);
  const companyIdRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      userRef.current = u;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const id = localStorage.getItem('last_used_company_id');
    if (id) companyIdRef.current = id;

    const handleCompanySwitch = (e) => {
      if (e.detail?.companyId) companyIdRef.current = e.detail.companyId;
    };
    window.addEventListener('company-switched', handleCompanySwitch);
    return () => window.removeEventListener('company-switched', handleCompanySwitch);
  }, []);

  const sendHeartbeat = async (pathname) => {
    if (isImpersonating) return;
    const user = userRef.current;
    const companyId = companyIdRef.current || localStorage.getItem('last_used_company_id');
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
