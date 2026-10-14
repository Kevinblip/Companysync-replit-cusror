import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Pencil, Sparkles } from "lucide-react";

const FILED_STATUSES = new Set(["sent", "accepted", "declined"]);

export function estimateIsFiled(status) {
  return FILED_STATUSES.has(String(status || "").toLowerCase());
}

/** Query string that reopens an estimate in the AI estimator and updates that same record. */
export function aiEstimatorEditSearch(estimate) {
  const params = new URLSearchParams({
    customer_name: estimate?.customer_name || "",
    customer_email: estimate?.customer_email || "",
    customer_phone: estimate?.customer_phone || "",
    property_address: estimate?.property_address || "",
    insurance_company: estimate?.insurance_company || "",
    claim_number: estimate?.claim_number || "",
    adjuster_name: estimate?.adjuster_name || "",
    adjuster_phone: estimate?.adjuster_phone || "",
  });
  if (estimate?.id) {
    params.set("edit_estimate_id", estimate.id);
    params.set("estimate_number", estimate.estimate_number || "");
  }
  return params.toString();
}

/**
 * Drafts are edited in place (this page or the AI estimator).
 * A separate insurance supplement or change order is the path after the
 * original has been sent, accepted, or declined.
 */
export default function ReviseEstimateDialog({
  open,
  onOpenChange,
  estimate,
  onEditHere,
  onOpenAiEstimator,
  onCreateCopy,
}) {
  const [supplementKind, setSupplementKind] = useState("supplement");
  const [changeOrderReason, setChangeOrderReason] = useState("");

  useEffect(() => {
    if (!open) {
      setSupplementKind("supplement");
      setChangeOrderReason("");
    }
  }, [open]);

  const number = estimate?.estimate_number || "this estimate";
  const customer = estimate?.customer_name || "";
  const status = String(estimate?.status || "draft").toLowerCase();
  const filed = estimateIsFiled(status);
  const asChangeOrder = supplementKind === "change_order";
  const customerPhrase = customer ? (
    <>
      {" "}
      for <strong>{customer}</strong>
    </>
  ) : null;

  const editActions = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={onEditHere}
        data-testid="button-edit-estimate-here"
      >
        <Pencil className="w-4 h-4 mr-2" />
        {filed ? "Edit this estimate" : "Edit here"}
      </Button>
      <Button
        type="button"
        onClick={onOpenAiEstimator}
        className="bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700"
        data-testid="button-open-ai-estimator-revise"
      >
        <Sparkles className="w-4 h-4 mr-2" />
        Open AI Estimator
      </Button>
    </div>
  );

  const copyChoices = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSupplementKind("supplement")}
          className={`rounded-lg border p-3 text-left transition-colors ${supplementKind === "supplement" ? "border-orange-400 bg-orange-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
          data-testid="button-kind-supplement"
        >
          <div className="text-sm font-semibold text-gray-900">Insurance supplement</div>
          <div className="text-xs text-gray-500 mt-0.5">Extra scope submitted to the carrier</div>
        </button>
        <button
          type="button"
          onClick={() => setSupplementKind("change_order")}
          className={`rounded-lg border p-3 text-left transition-colors ${supplementKind === "change_order" ? "border-purple-400 bg-purple-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
          data-testid="button-kind-change-order"
        >
          <div className="text-sm font-semibold text-gray-900">Change order</div>
          <div className="text-xs text-gray-500 mt-0.5">Scope change approved in the office</div>
        </button>
      </div>

      {asChangeOrder && (
        <div>
          <Label htmlFor="revise-co-reason" className="text-sm">Why is the scope changing?</Label>
          <Textarea
            id="revise-co-reason"
            value={changeOrderReason}
            onChange={(e) => setChangeOrderReason(e.target.value)}
            placeholder="e.g. Homeowner upgraded to architectural shingle; added 2 skylights"
            rows={2}
            className="mt-1 bg-white"
            data-testid="input-change-order-reason"
          />
          <p className="text-xs text-gray-500 mt-1">
            It will be created pending approval. Nothing reaches an invoice until the office approves it.
          </p>
        </div>
      )}
    </div>
  );

  const createCopy = () => {
    onCreateCopy?.({ asChangeOrder, reason: changeOrderReason });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="revise-estimate-dialog">
        <DialogHeader>
          <DialogTitle>{filed ? "Supplement or change order" : "Change this estimate"}</DialogTitle>
          <DialogDescription>
            {filed ? (
              <>
                <strong>{number}</strong>
                {customerPhrase} is already {status}. A copy keeps that version as filed. The new draft does not change the original until you save and send it.
              </>
            ) : (
              <>
                <strong>{number}</strong>
                {customerPhrase} is still a draft. Edit it on this page or reopen it in the AI estimator. Both update this estimate.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {filed ? (
          <div className="space-y-4">
            {copyChoices}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <p className="text-sm font-medium text-gray-900">Need to correct this estimate instead?</p>
              <p className="text-xs text-gray-500">
                Manual edits and the AI estimator update {number} itself.
              </p>
              {editActions}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {editActions}
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Already sent this to the customer or the carrier?</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  A copy leaves {number} as filed. Use an insurance supplement for extra carrier scope, or a change order for a scope change the office approves.
                </p>
              </div>
              {copyChoices}
              <Button
                type="button"
                variant="outline"
                className={`w-full ${asChangeOrder ? "border-purple-300 text-purple-800 hover:bg-purple-50" : "border-amber-300 text-amber-800 hover:bg-amber-100"}`}
                disabled={asChangeOrder && !changeOrderReason.trim()}
                onClick={createCopy}
                data-testid="button-create-supplement-confirm"
              >
                <Copy className="w-4 h-4 mr-2" />
                {asChangeOrder ? "Create change order copy" : "Create supplement copy"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {filed ? "Cancel" : "Close"}
          </Button>
          {filed && (
            <Button
              type="button"
              className={asChangeOrder ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-amber-600 hover:bg-amber-700 text-white"}
              disabled={asChangeOrder && !changeOrderReason.trim()}
              onClick={createCopy}
              data-testid="button-create-supplement-confirm"
            >
              <Copy className="w-4 h-4 mr-2" />
              {asChangeOrder ? "Create Change Order" : "Create Supplement"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
