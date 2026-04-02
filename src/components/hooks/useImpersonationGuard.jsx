import { useCallback } from "react";
import { toast } from "sonner";
import { useImpersonation } from "@/lib/ImpersonationContext";

export function useImpersonationGuard() {
  const { isImpersonating, impersonatedCompanyName } = useImpersonation();

  const guardAction = useCallback((actionLabel = "This action") => {
    if (!isImpersonating) return true;

    toast.error(`Read-Only Mode: ${actionLabel} is blocked during impersonation.`, {
      description: `You are viewing ${impersonatedCompanyName || "another company"}'s data in read-only mode. Stop impersonating to make changes to your own data.`,
      duration: 5000,
    });
    return false;
  }, [isImpersonating, impersonatedCompanyName]);

  return {
    isImpersonating,
    impersonatedCompanyName,
    guardAction,
  };
}
