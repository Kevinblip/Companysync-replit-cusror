import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { captureAttribution, isTrackablePath, trackPageView } from '@/lib/analytics';

export default function PageViewTracker() {
  const location = useLocation();
  const last = useRef('');

  useEffect(() => {
    const path = location.pathname;
    if (last.current === path) return;
    last.current = path;
    captureAttribution();
    if (!isTrackablePath(path)) return;
    trackPageView(path);
  }, [location.pathname]);

  return null;
}
