import { useCallback } from "react";
import { toast } from "sonner";
import { useImpersonation } from "@/lib/ImpersonationContext";

export function useImpersonationGuard() {
  const { isImpersonating, impersonatedCompanyName } = useImpersonation();

  const guardAction = useCallback((actionLabel = "This action") => {
    return true;
  }, [isImpersonating, impersonatedCompanyName]);

  return {
    isImpersonating,
    impersonatedCompanyName,
    guardAction,
  };
}
