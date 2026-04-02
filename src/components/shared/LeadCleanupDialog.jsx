import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";

export default function LeadCleanupDialog({
  open,
  onOpenChange,
  emptyLeads,
  leadsWithoutCompany,
  duplicateLeadsToDelete,
  duplicateWarningsData,
  cleanupEmptyLeadsMutation,
  backfillCompanyIdMutation,
  deleteDuplicateLeadsMutation,
  resolveDuplicatesMutation,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-600" />
            Lead Cleanup Tools
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
            <div>
              <p className="font-medium">Empty Leads</p>
              <p className="text-sm text-gray-500">{emptyLeads.length} leads with no name/contact</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={emptyLeads.length === 0 || cleanupEmptyLeadsMutation.isPending}
              onClick={() => cleanupEmptyLeadsMutation.mutate()}
            >
              {cleanupEmptyLeadsMutation.isPending ? 'Deleting...' : 'Delete All'}
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
            <div>
              <p className="font-medium">Missing Company IDs</p>
              <p className="text-sm text-gray-500">{leadsWithoutCompany} leads need linking</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={leadsWithoutCompany === 0 || backfillCompanyIdMutation.isPending}
              onClick={() => backfillCompanyIdMutation.mutate()}
            >
              {backfillCompanyIdMutation.isPending ? 'Fixing...' : 'Fix All'}
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
            <div>
              <p className="font-medium">Duplicate Leads</p>
              <p className="text-sm text-gray-500">{duplicateLeadsToDelete.length} duplicates within Leads (keeps newest)</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={duplicateLeadsToDelete.length === 0 || deleteDuplicateLeadsMutation.isPending}
              onClick={() => deleteDuplicateLeadsMutation.mutate()}
            >
              {deleteDuplicateLeadsMutation.isPending ? 'Deleting...' : 'Delete Duplicates'}
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
            <div>
              <p className="font-medium">Duplicate Contacts</p>
              <p className="text-sm text-gray-500">{duplicateWarningsData.length} leads match customers</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={duplicateWarningsData.length === 0 || resolveDuplicatesMutation.isPending}
              onClick={() => resolveDuplicatesMutation.mutate()}
            >
              {resolveDuplicatesMutation.isPending ? 'Deleting...' : 'Delete All'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
