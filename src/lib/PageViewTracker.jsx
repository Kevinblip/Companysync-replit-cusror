import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { captureAttribution, track } from '@/lib/analytics';

// Virtual page views for the SPA. Query strings stay off the hit: some in-app
// URLs carry ids. GTM should send GA4/Meta page_view from this event and turn
// off the automatic history page view, or the first load is counted twice.
export default function PageViewTracker() {
  const location = useLocation();
  const lastPath = useRef('');

  useEffect(() => {
    captureAttribution();
  }, [location.pathname, location.search]);

  useEffect(() => {
    const path = location.pathname || '/';
    if (lastPath.current === path) return;
    lastPath.current = path;
    track('page_view', {
      page_path: path,
      page_location: `${window.location.origin}${path}`,
      page_title: document.title,
    });
  }, [location.pathname]);

  return null;
}
