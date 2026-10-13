import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getLastUsedCompanyId } from '@/lib/activeCompanySelection';
import { useImpersonation } from '@/lib/ImpersonationContext';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function useBulkDeletePermission() {
  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
    staleTime: 60000,
  });
  const { impersonatedCompanyId } = useImpersonation();
  const companyId = impersonatedCompanyId || getLastUsedCompanyId(user?.email);
  const { data, isError } = useQuery({
    queryKey: ['bulk-delete-permission', companyId, user?.email],
    enabled: Boolean(user?.email),
    staleTime: 30000,
    queryFn: async () => {
      const response = await fetch(`/api/local/bulk-delete-permission?company_id=${encodeURIComponent(companyId || '')}`);
      if (!response.ok) throw new Error('Unable to check bulk-delete permission');
      return response.json();
    },
  });
  return !isError && data?.allowed === true;
}

export function BulkDeleteButton(props) {
  const allowed = useBulkDeletePermission();
  return allowed ? <Button {...props} /> : null;
}

export function BulkDeleteMenuItem(props) {
  const allowed = useBulkDeletePermission();
  return allowed ? <DropdownMenuItem {...props} /> : null;
}
