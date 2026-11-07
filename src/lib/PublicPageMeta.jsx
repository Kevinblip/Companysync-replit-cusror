import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyPageMeta } from '@/lib/pageMeta';

export default function PublicPageMeta() {
  const location = useLocation();
  useEffect(() => applyPageMeta(location.pathname), [location.pathname]);
  return null;
}
