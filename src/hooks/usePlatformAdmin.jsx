import { useMemo } from "react";
import { PLATFORM_COMPANY_ID } from "@/lib/constants";

export function isPlatformAdminCheck(user, myCompany, myStaffProfile) {
  if (!user) return false;
  if (user.platform_role === 'super_admin' || user.platform_role === 'admin') return true;
  if (myCompany?.id === PLATFORM_COMPANY_ID) return true;
  if (myStaffProfile?.is_platform_admin === true) return true;
  return false;
}

export default function usePlatformAdmin(user, myCompany, myStaffProfile) {
  return useMemo(() => isPlatformAdminCheck(user, myCompany, myStaffProfile), [user, myCompany, myStaffProfile]);
}
