import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { toast } from "sonner";

// ── Category definitions ────────────────────────────────────────────────────
export const RATING_CATEGORIES = [
  { key: "cleanup",       label: "Clean Up",      desc: "Site left clean after work" },
  { key: "on_time",       label: "On Time",        desc: "Showed up and finished on schedule" },
  { key: "quality",       label: "Quality of Work",desc: "Workmanship and attention to detail" },
  { key: "punch_outs",    label: "Punch Outs",     desc: "Completed all punch-out items" },
  { key: "response_time", label: "Response Time",  desc: "Speed of communication & replies" },
];

// ── Star picker ─────────────────────────────────────────────────────────────
function StarPicker({ value, onChange, disabled = false }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          disabled={disabled}
          key={n}
          type="button"
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}
          className="focus:outline-none"
        >
          <Star
            className={`w-7 h-7 transition-colors ${
              n <= (hovered || value)
                ? "text-yellow-400 fill-yellow-400"
                : "text-gray-300"
            }`}
          />
        </button>
      ))}
      {value > 0 && (
        <span className="ml-1 text-sm text-gray-500 self-center">{value}/5</span>
      )}
    </div>
  );
}

// ── Star display (read-only) ─────────────────────────────────────────────────
export function StarDisplay({ value, size = "sm" }) {
  const sz = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
  const filled = Math.round(value || 0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          className={`${sz} ${n <= filled ? "text-yellow-400 fill-yellow-400" : "text-gray-300"}`}
        />
      ))}
    </div>
  );
}

// ── Main dialog ─────────────────────────────────────────────────────────────
export default function SubcontractorRatingDialog({
  open,
  onOpenChange,
  subcontractor,   // full sub record
  companyId,
  raterName = "", // display name of the staff member entering the rating
}) {
  const qc = useQueryClient();
  const empty = () =>
    RATING_CATEGORIES.reduce((a, c) => ({ ...a, [c.key]: 0 }), { overall: 0, notes: "" });
  const [form, setForm] = useState(empty);
  const [saveError, setSaveError] = useState('');
  const savedRatingRef = React.useRef(null);

  // Reset when opened
  React.useEffect(() => {
    if (open) {
      setForm(empty());
      setSaveError('');
      savedRatingRef.current = null;
    }
  }, [open, subcontractor?.id]);

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  // Auto-compute overall from category averages when any category changes
  React.useEffect(() => {
    const vals = RATING_CATEGORIES.map(c => form[c.key]).filter(v => v > 0);
    if (vals.length === RATING_CATEGORIES.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      setForm(p => ({ ...p, overall: Math.round(avg) }));
    }
  }, [form.cleanup, form.on_time, form.quality, form.punch_outs, form.response_time]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveError('');
      if (!companyId || !subcontractor?.id) throw new Error('Choose a company and subcontractor before saving a rating.');
      // Validate — all categories required
      const missing = RATING_CATEGORIES.filter(c => !form[c.key]);
      if (missing.length) throw new Error(`Please rate: ${missing.map(c => c.label).join(", ")}`);
      if (!form.overall) throw new Error("Overall rating is required");

      // Save the rating record
      if (!savedRatingRef.current) {
        const saved = await base44.entities.SubcontractorRating.create({
          company_id: companyId,
          data: {
            subcontractor_id: subcontractor.id,
            subcontractor_name: subcontractor.name,
            cleanup: form.cleanup,
            on_time: form.on_time,
            quality: form.quality,
            punch_outs: form.punch_outs,
            response_time: form.response_time,
            overall: form.overall,
            notes: form.notes.trim(),
            rated_by_name: raterName || "",
            rated_at: new Date().toISOString(),
          },
        });
        savedRatingRef.current = saved;
      }

      // Recompute overall average and write back to the subcontractor record
      const all = await base44.entities.SubcontractorRating.filter({ company_id: companyId });
      const mine = all.filter(r => (r.data?.subcontractor_id || r.subcontractor_id) === subcontractor.id);
      if (!mine.length) throw new Error('The saved rating could not be read back. Retry to refresh the summary.');
      const avgOverall = mine.reduce((s, r) => s + Number(r.data?.overall ?? r.overall ?? 0), 0) / mine.length;
      await base44.entities.Subcontractor.update(subcontractor.id, {
        rating: Math.round(avgOverall * 10) / 10,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      qc.invalidateQueries({ queryKey: ["subcontractor-ratings"] });
      toast.success("Rating saved!");
      onOpenChange(false);
    },
    onError: (e) => {
      const authError = e.status === 401 || /unauthorized/i.test(e.message);
      const message = authError
        ? 'Your sign-in could not be verified. Sign in again in another tab, then retry. Your rating entries are still here.'
        : e.status === 403
          ? 'Your account does not have permission to save this rating. Check that you are in the correct company.'
          : e.message;
      const detail = savedRatingRef.current
        ? `The rating was recorded, but its summary could not be updated. Retrying will not add a duplicate. ${message}`
        : message;
      setSaveError(detail);
      if (savedRatingRef.current) qc.invalidateQueries({ queryKey: ["subcontractor-ratings"] });
      toast.error(detail);
    },
  });

  const allFilled = RATING_CATEGORIES.every(c => form[c.key] > 0) && form.overall > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saveMutation.isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Rate {subcontractor?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Category ratings */}
          {RATING_CATEGORIES.map(cat => (
            <div key={cat.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">{cat.label}</p>
                <p className="text-xs text-gray-500">{cat.desc}</p>
              </div>
              <div className="shrink-0">
                <StarPicker value={form[cat.key]} onChange={v => set(cat.key, v)} disabled={saveMutation.isPending || Boolean(savedRatingRef.current)} />
              </div>
            </div>
          ))}

          {/* Divider */}
          <div className="border-t pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-gray-900">Overall Rating</p>
                <p className="text-xs text-gray-500">Auto-filled from categories, or set manually</p>
              </div>
              <div className="shrink-0">
                <StarPicker value={form.overall} onChange={v => set("overall", v)} disabled={saveMutation.isPending || Boolean(savedRatingRef.current)} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <Textarea
            placeholder="Optional notes (what went well, what to improve…)"
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            className="h-20 resize-none text-sm"
            disabled={saveMutation.isPending || Boolean(savedRatingRef.current)}
          />
          {saveError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={saveMutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!allFilled || saveMutation.isPending}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
          >
            {saveMutation.isPending ? "Saving…" : "Save Rating"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
