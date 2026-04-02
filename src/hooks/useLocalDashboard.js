import { useQuery } from '@tanstack/react-query';

export function useLocalDashboard(companyId, options = {}) {
  return useQuery({
    queryKey: ['local-dashboard', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const response = await fetch(`/api/local/dashboard?company_id=${encodeURIComponent(companyId)}`);
      if (!response.ok) throw new Error('Dashboard fetch failed');
      const data = await response.json();
      return data.data;
    },
    enabled: !!companyId,
    staleTime: 30000,
    refetchInterval: 60000,
    ...options,
  });
}

export function useLocalEntities(entityType, companyId, options = {}) {
  const { limit = 200, offset = 0, status, sort, order, search, ...queryOptions } = options;

  const params = new URLSearchParams({ company_id: companyId });
  if (limit) params.set('limit', limit);
  if (offset) params.set('offset', offset);
  if (status) params.set('status', status);
  if (sort) params.set('sort', sort);
  if (order) params.set('order', order);
  if (search) params.set('search', search);

  return useQuery({
    queryKey: ['local-entities', entityType, companyId, { limit, offset, status, sort, order, search }],
    queryFn: async () => {
      if (!companyId) return { records: [], total: 0 };
      const response = await fetch(`/api/local/entities/${entityType}?${params.toString()}`);
      if (!response.ok) throw new Error(`Entity fetch failed: ${entityType}`);
      const data = await response.json();
      return data;
    },
    enabled: !!companyId,
    staleTime: 30000,
    ...queryOptions,
  });
}

export function useLocalReports(companyId, reportType, options = {}) {
  return useQuery({
    queryKey: ['local-reports', companyId, reportType],
    queryFn: async () => {
      if (!companyId || !reportType) return [];
      const response = await fetch(`/api/local/reports?company_id=${encodeURIComponent(companyId)}&type=${encodeURIComponent(reportType)}`);
      if (!response.ok) throw new Error('Report fetch failed');
      const data = await response.json();
      return data.data;
    },
    enabled: !!companyId && !!reportType,
    staleTime: 60000,
    ...options,
  });
}
