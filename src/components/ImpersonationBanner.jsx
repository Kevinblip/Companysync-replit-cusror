import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, X, ChevronDown, User, Eye } from "lucide-react";
import { useImpersonation } from "@/lib/ImpersonationContext";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { scrubMoneyInTree } from "@/lib/privacyMoney";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function PrivacyAmountScrubber() {
  useEffect(() => {
    const run = () => scrubMoneyInTree(document.body);
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}

export default function ImpersonationBanner() {
  const {
    isImpersonating,
    impersonatedCompanyName,
    impersonatedCompanyId,
    stopImpersonation,
    viewAsUserEmail,
    viewAsUserName,
    isViewingAsUser,
    startViewAsUser,
    stopViewAsUser,
    privacyRevealed,
    revealPrivacy,
  } = useImpersonation();
  const queryClient = useQueryClient();
  const [isStopping, setIsStopping] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [isRevealing, setIsRevealing] = useState(false);

  const { data: staffMembers = [] } = useQuery({
    queryKey: ['impersonation-staff', impersonatedCompanyId],
    queryFn: () => impersonatedCompanyId
      ? base44.entities.StaffProfile.filter({ company_id: impersonatedCompanyId })
      : [],
    enabled: isImpersonating && !!impersonatedCompanyId,
    staleTime: 60000,
  });

  if (!isImpersonating) return null;

  const handleReveal = async () => {
    const reason = revealReason.trim();
    if (reason.length < 8) {
      toast.error('Enter a reason of at least 8 characters.');
      return;
    }
    setIsRevealing(true);
    try {
      await revealPrivacy(reason);
      setRevealOpen(false);
      setRevealReason('');
      queryClient.invalidateQueries();
      toast.success('Personal info is visible for this support session and the reason was logged.');
    } catch (error) {
      toast.error(error.message || 'Could not reveal personal info.');
    } finally {
      setIsRevealing(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await stopImpersonation();
    } catch (error) {
      toast.error('Could not end the company session. Please try again.');
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <>
    {!privacyRevealed && <PrivacyAmountScrubber />}
    <Alert className="fixed top-0 left-0 right-0 z-50 rounded-none border-0 bg-red-600 text-white shadow-lg">
      <AlertDescription className="flex items-center justify-between max-w-7xl mx-auto px-4 py-1 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Shield className="w-5 h-5 shrink-0" />
          <span className="font-bold text-base">
            IMPERSONATING: {impersonatedCompanyName}
          </span>
          <span className="text-sm font-medium" data-testid="text-privacy-mode">
            {privacyRevealed
              ? 'Privacy reveal is on for this session. Personal info is visible.'
              : 'Privacy mode: personal info and amounts hidden'}
          </span>

          {isViewingAsUser ? (
            <div className="flex items-center gap-2 bg-red-700 rounded-full px-3 py-1 text-sm">
              <Eye className="w-3.5 h-3.5" />
              <span className="font-medium">Viewing as <strong>{viewAsUserName}</strong></span>
              <button
                onClick={stopViewAsUser}
                className="ml-1 hover:opacity-75 transition-opacity"
                data-testid="button-stop-view-as"
                title="Stop viewing as user"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!privacyRevealed && (
            revealOpen ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => { event.preventDefault(); handleReveal(); }}
              >
                <input
                  value={revealReason}
                  onChange={(event) => setRevealReason(event.target.value)}
                  placeholder="Reason for revealing"
                  className="h-8 w-44 rounded border border-white/40 bg-white px-2 text-xs text-slate-900"
                  data-testid="input-privacy-reveal-reason"
                  aria-label="Reason for revealing personal info"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isRevealing}
                  className="bg-white text-red-600 hover:bg-red-50"
                  data-testid="button-confirm-privacy-reveal"
                >
                  {isRevealing ? 'Saving…' : 'Confirm'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="bg-white/10 text-white border-white/40"
                  onClick={() => { setRevealOpen(false); setRevealReason(''); }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-white/10 text-white hover:bg-white/20 border-white/40"
                onClick={() => setRevealOpen(true)}
                data-testid="button-reveal-privacy"
              >
                <Eye className="w-3.5 h-3.5 mr-1" />
                Reveal
              </Button>
            )
          )}
          {staffMembers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white/10 text-white hover:bg-white/20 border-white/40 gap-1.5"
                  data-testid="button-view-as-user"
                >
                  <User className="w-3.5 h-3.5" />
                  {isViewingAsUser ? `Viewing as ${viewAsUserName}` : 'View as User'}
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Staff Members</div>
                {staffMembers.map((staff) => (
                  <DropdownMenuItem
                    key={staff.id}
                    onClick={() => startViewAsUser({
                      userEmail: staff.user_email || staff.email,
                      userName: staff.full_name || staff.name || staff.user_email || staff.email,
                    })}
                    className="flex items-center gap-2 cursor-pointer"
                    data-testid={`menu-view-as-${staff.id}`}
                  >
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                      {(staff.full_name || staff.name || staff.user_email || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{staff.full_name || staff.name || staff.user_email}</span>
                      <span className="text-xs text-muted-foreground truncate">{staff.user_email || staff.email}</span>
                    </div>
                    {viewAsUserEmail === (staff.user_email || staff.email) && (
                      <Eye className="w-3.5 h-3.5 text-blue-500 ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
                {isViewingAsUser && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={stopViewAsUser} className="text-muted-foreground cursor-pointer">
                      <X className="w-3.5 h-3.5 mr-2" />
                      Back to company admin view
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            onClick={handleStop}
            disabled={isStopping}
            variant="outline"
            size="sm"
            className="bg-white text-red-600 hover:bg-red-50 border-white"
            data-testid="button-stop-impersonation"
          >
            <X className="w-4 h-4 mr-2" />
            Stop Impersonating
          </Button>
        </div>
      </AlertDescription>
    </Alert>
    </>
  );
}
