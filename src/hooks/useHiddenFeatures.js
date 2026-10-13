import { useMemo } from "react";
import { HIDDEN_FEATURES } from "@/config/hiddenFeatures";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";

/**
 * Returns the HIDDEN_FEATURES registry gated behind a platform-admin check.
 *
 * Flags set to `true` are only visible when the current user is a CompanySync
 * platform admin (company_id === PLATFORM_COMPANY_ID, or platform_role is
 * super_admin/admin). All other users see every flag as `false` — i.e. the
 * feature is hidden from them completely.
 *
 * Flags set to `false` are always hidden regardless of who is logged in.
 *
 * Usage:
 *   const HIDDEN_FEATURES = useHiddenFeatures();
 *   // Then use HIDDEN_FEATURES.MY_FLAG exactly as before.
 */
export default function useHiddenFeatures() {
  const { user, myCompany } = useRoleBasedData();
  const isPlatformAdmin = isPlatformAdminCheck(user, myCompany, null);

  return useMemo(() => {
    if (isPlatformAdmin) return HIDDEN_FEATURES;
    // Non-platform-admin: mask every flag to false so hidden features
    // are truly invisible outside the CompanySync admin account.
    const masked = {};
    for (const key of Object.keys(HIDDEN_FEATURES)) {
      masked[key] = false;
    }
    return masked;
  }, [isPlatformAdmin]);
}
