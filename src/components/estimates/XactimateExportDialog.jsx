import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText } from "lucide-react";
import { generateXactimateHTML, validateInsuranceEstimateData } from "@/utils/insuranceEstimateTemplates";
import {
  buildXactimateDataFromAIEstimator,
  DEFAULT_EXPORT_OPTIONS,
  stripPerClaimKeys,
  reseedXactimateOptsForCustomer,
} from "@/utils/xactimatePdfAdapter";

// ---------------------------------------------------------------------------
// XactimateExportDialog
// ---------------------------------------------------------------------------
// The insurance-style ("Xactimate") PDF export dialog for the AI Estimator.
// Extracted from AIEstimator so the full export flow (toggle options → generate
// → produced HTML) can be driven and asserted in a DOM test without mounting
// the 13k-line estimator page.
//
// Per-claim fields (claim/policy #, dates, deductible, insurer, loss type) are
// NEVER persisted — persisting them would leak one customer's claim details
// onto another customer's export. Only reusable settings (toggles, percentages,
// section/price list) are saved to localStorage. Each time the dialog OPENS we
// re-seed the per-claim fields from the CURRENT customer (via
// reseedXactimateOptsForCustomer) so a prior customer's claim data can't carry
// over. The per-claim helpers live in the adapter so they stay unit-testable.
// ---------------------------------------------------------------------------
export default function XactimateExportDialog({
  open,
  onOpenChange,
  lineItems = [],
  customerInfo = {},
  satelliteAnalysis = null,
  myCompany = {},
  onSuccess,
}) {
  const [xactimateOpts, setXactimateOpts] = useState(() => {
    try {
      const saved = localStorage.getItem('aiEstimatorXactimateOpts');
      if (saved) return { ...DEFAULT_EXPORT_OPTIONS, ...stripPerClaimKeys(JSON.parse(saved)) };
    } catch (e) { /* ignore parse errors */ }
    return { ...DEFAULT_EXPORT_OPTIONS };
  });
  const setXOpt = (patch) => setXactimateOpts((prev) => ({ ...prev, ...patch }));

  // Seed per-claim fields from the CURRENT customer each time the dialog opens,
  // so one customer's claim/policy details never carry over to another's export.
  useEffect(() => {
    if (open) {
      setXactimateOpts((prev) => reseedXactimateOptsForCustomer(prev, customerInfo));
    }
    // Intentionally keyed on `open` only: re-seed on each open, not on every
    // customerInfo keystroke while the dialog is already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleGenerate = () => {
    try {
      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        alert('No line items to export yet. Build an estimate first.');
        return;
      }
      try {
        localStorage.setItem('aiEstimatorXactimateOpts', JSON.stringify(stripPerClaimKeys(xactimateOpts)));
      } catch (e) { /* ignore */ }
      const { data, options } = buildXactimateDataFromAIEstimator({
        customerInfo, lineItems, satelliteAnalysis, myCompany, exportOptions: xactimateOpts,
      });
      const warnings = validateInsuranceEstimateData(data);
      if (warnings.length > 0) {
        const proceed = window.confirm(
          'Please review before generating:\n\n' +
          warnings.map((w, i) => `${i + 1}. ${w}`).join('\n\n') +
          '\n\nGenerate the PDF anyway?'
        );
        if (!proceed) return;
      }
      const html = generateXactimateHTML(data, options);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
        onOpenChange?.(false);
        onSuccess?.();
      } else {
        alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
      }
    } catch (error) {
      alert('Failed to generate Xactimate PDF: ' + error.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Xactimate PDF Options
          </DialogTitle>
          <DialogDescription>
            Choose what to include on the insurance-style estimate. Your choices are saved for next time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Overhead & Profit */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">Overhead &amp; Profit (O&amp;P)</Label>
                <p className="text-xs text-muted-foreground">Adds an overhead/profit markup, common on insurance jobs.</p>
              </div>
              <Switch
                checked={xactimateOpts.includeOP}
                onCheckedChange={(v) => setXOpt({ includeOP: v })}
                data-testid="switch-xactimate-op"
              />
            </div>
            {xactimateOpts.includeOP && (
              <div className="grid grid-cols-2 gap-3 pl-1">
                <div>
                  <Label className="text-xs">Overhead %</Label>
                  <Input type="number" min="0" step="0.5" value={xactimateOpts.overheadPct}
                    onChange={(e) => setXOpt({ overheadPct: Number(e.target.value) })}
                    data-testid="input-xactimate-overhead" />
                </div>
                <div>
                  <Label className="text-xs">Profit %</Label>
                  <Input type="number" min="0" step="0.5" value={xactimateOpts.profitPct}
                    onChange={(e) => setXOpt({ profitPct: Number(e.target.value) })}
                    data-testid="input-xactimate-profit" />
                </div>
              </div>
            )}
          </div>

          {/* Material tax */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Material Sales Tax %</Label>
            <p className="text-xs text-muted-foreground">Applied to material lines only (tear-off, haul &amp; labor are not taxed). Leave 0 for none.</p>
            <Input type="number" min="0" step="0.01" value={xactimateOpts.taxPct}
              onChange={(e) => setXOpt({ taxPct: Number(e.target.value) })}
              data-testid="input-xactimate-tax" />
          </div>

          {/* Depreciation */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">Depreciation (RCV → ACV)</Label>
                <p className="text-xs text-muted-foreground">Show recoverable depreciation and Actual Cash Value.</p>
              </div>
              <Switch
                checked={xactimateOpts.includeDepreciation}
                onCheckedChange={(v) => setXOpt({ includeDepreciation: v })}
                data-testid="switch-xactimate-dep"
              />
            </div>
            {xactimateOpts.includeDepreciation && (
              <div className="space-y-3 pl-1">
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select value={xactimateOpts.depMode} onValueChange={(v) => setXOpt({ depMode: v })}>
                    <SelectTrigger data-testid="select-xactimate-dep-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat percentage</SelectItem>
                      <SelectItem value="agelife">Age / Life</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {xactimateOpts.depMode === 'flat' ? (
                  <div>
                    <Label className="text-xs">Depreciation %</Label>
                    <Input type="number" min="0" max="100" step="1" value={xactimateOpts.depPct}
                      onChange={(e) => setXOpt({ depPct: Number(e.target.value) })}
                      data-testid="input-xactimate-dep-pct" />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Age (yrs)</Label>
                      <Input type="number" min="0" step="1" value={xactimateOpts.age}
                        onChange={(e) => setXOpt({ age: Number(e.target.value) })}
                        data-testid="input-xactimate-age" />
                    </div>
                    <div>
                      <Label className="text-xs">Life (yrs)</Label>
                      <Input type="number" min="1" step="1" value={xactimateOpts.life}
                        onChange={(e) => setXOpt({ life: Number(e.target.value) })}
                        data-testid="input-xactimate-life" />
                    </div>
                    <div>
                      <Label className="text-xs">Condition</Label>
                      <Input value={xactimateOpts.condition}
                        onChange={(e) => setXOpt({ condition: e.target.value })}
                        placeholder="Avg"
                        data-testid="input-xactimate-condition" />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Show per-line Age/Life/Dep% columns</Label>
                  <Switch
                    checked={xactimateOpts.showDepColumns}
                    onCheckedChange={(v) => setXOpt({ showDepColumns: v })}
                    data-testid="switch-xactimate-dep-columns"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Deductible */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Deductible</Label>
            <p className="text-xs text-muted-foreground">Subtracted from the net claim total (the homeowner's out-of-pocket amount).</p>
            <Input type="number" min="0" step="0.01" value={xactimateOpts.deductible}
              onChange={(e) => setXOpt({ deductible: Number(e.target.value) })}
              data-testid="input-xactimate-deductible" />
          </div>

          {/* Trade summary */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Trade Summary page</Label>
              <p className="text-xs text-muted-foreground">Totals grouped by trade at the end.</p>
            </div>
            <Switch
              checked={xactimateOpts.includeTradeSummary}
              onCheckedChange={(v) => setXOpt({ includeTradeSummary: v })}
              data-testid="switch-xactimate-trade-summary"
            />
          </div>

          {/* Claim details */}
          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold">Claim Details (optional)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Claim #</Label>
                <Input value={xactimateOpts.claimNumber}
                  onChange={(e) => setXOpt({ claimNumber: e.target.value })}
                  placeholder={customerInfo?.claim_number || ''}
                  data-testid="input-xactimate-claim" />
              </div>
              <div>
                <Label className="text-xs">Policy #</Label>
                <Input value={xactimateOpts.policyNumber}
                  onChange={(e) => setXOpt({ policyNumber: e.target.value })}
                  data-testid="input-xactimate-policy" />
              </div>
              <div>
                <Label className="text-xs">Insurance Company</Label>
                <Input value={xactimateOpts.insuranceCompany}
                  onChange={(e) => setXOpt({ insuranceCompany: e.target.value })}
                  placeholder={customerInfo?.insurance_company || ''}
                  data-testid="input-xactimate-insurer" />
              </div>
              <div>
                <Label className="text-xs">Type of Loss</Label>
                <Input value={xactimateOpts.typeOfLoss}
                  onChange={(e) => setXOpt({ typeOfLoss: e.target.value })}
                  placeholder="Hail / Wind"
                  data-testid="input-xactimate-loss" />
              </div>
              <div>
                <Label className="text-xs">Price List</Label>
                <Input value={xactimateOpts.priceList}
                  onChange={(e) => setXOpt({ priceList: e.target.value })}
                  placeholder="e.g. TXDA8X_JUL26"
                  data-testid="input-xactimate-pricelist" />
              </div>
              <div>
                <Label className="text-xs">Section Label</Label>
                <Input value={xactimateOpts.sectionLabel}
                  onChange={(e) => setXOpt({ sectionLabel: e.target.value })}
                  placeholder="Roof"
                  data-testid="input-xactimate-section" />
              </div>
              <div>
                <Label className="text-xs">Date of Loss</Label>
                <Input type="date" value={xactimateOpts.dateOfLoss}
                  onChange={(e) => setXOpt({ dateOfLoss: e.target.value })}
                  data-testid="input-xactimate-date-loss" />
              </div>
              <div>
                <Label className="text-xs">Date Inspected</Label>
                <Input type="date" value={xactimateOpts.dateInspected}
                  onChange={(e) => setXOpt({ dateInspected: e.target.value })}
                  data-testid="input-xactimate-date-inspected" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange?.(false)} data-testid="button-xactimate-cancel">
            Cancel
          </Button>
          <Button onClick={handleGenerate} data-testid="button-xactimate-generate">
            <FileText className="w-4 h-4 mr-2" />
            Generate PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
