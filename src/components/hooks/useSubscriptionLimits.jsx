import { useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export const useSubscriptionLimits = () => {
  const checkLimit = useCallback(async (companyId, entityType) => {
    try {
      const response = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: companyId,
        entity_type: entityType
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to check limits');
      }

      return response.data;
    } catch (error) {
      console.error('Limit check error:', error);
      throw error;
    }
  }, []);

  const canCreateStaff = useCallback(async (companyId) => {
    const result = await checkLimit(companyId, 'staff');
    if (!result.can_create) {
      toast.error(`User limit reached (${result.current_count}/${result.limit}). Upgrade your plan to add more users.`);
      return false;
    }
    return true;
  }, [checkLimit]);

  const canCreateCustomer = useCallback(async (companyId) => {
    const result = await checkLimit(companyId, 'customer');
    if (!result.can_create) {
      toast.error(`Customer limit reached (${result.current_count}/${result.limit}). Upgrade your plan to add more customers.`);
      return false;
    }
    return true;
  }, [checkLimit]);

  const canCreateLead = useCallback(async (companyId) => {
    const result = await checkLimit(companyId, 'lead');
    if (!result.can_create) {
      toast.error(`Lead limit reached (${result.current_count}/${result.limit}). Upgrade your plan.`);
      return false;
    }
    return true;
  }, [checkLimit]);

  return {
    checkLimit,
    canCreateStaff,
    canCreateCustomer,
    canCreateLead
  };
};