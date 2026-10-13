import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, User, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { StarDisplay, RATING_CATEGORIES } from "./SubcontractorRatingDialog";

/**
 * Full rating history for one subcontractor — reverse-chronological list of
 * every rating record with per-category scores, notes, who rated, and delete.
 */
export default function SubcontractorRatingHistoryDialog({
  open,
  onOpenChange,
  subcontractor,
  companyId,
}) {
  const qc = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const { data: allRatings = [], isLoading } = useQuery({
    queryKey: ["subcontractor-ratings", companyId],
    queryFn: () => companyId ? base44.entities.SubcontractorRating.filter({ company_id: companyId }) : [],
    enabled: !!companyId && open,
  });

  const ratings = React.useMemo(() => {
    return allRatings
      .filter(r => r.data?.subcontractor_id === subcontractor?.id)
      .sort((a, b) => {
        const da = new Date(a.data?.rated_at || a.created_date || 0);
        const db = new Date(b.data?.rated_at || b.created_date || 0);
        return db - da; // newest first
      });
  }, [allRatings, subcontractor?.id]);

  const deleteMutation = useMutation({
    mutationFn: async (ratingId) => {
      if (!subcontractor?.id) throw new Error("No subcontractor selected");
      await base44.entities.SubcontractorRating.delete(ratingId);
      // Recompute the subcontractor's average from the remaining ratings
      const all = await base44.entities.SubcontractorRating.filter({ company_id: companyId });
      const mine = all.filter(r => r.data?.subcontractor_id === subcontractor.id);
      const avgOverall = mine.length
        ? mine.reduce((s, r) => s + (r.data?.overall || 0), 0) / mine.length
        : 0;
      await base44.entities.Subcontractor.update(subcontractor.id, {
        rating: Math.round(avgOverall * 10) / 10,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractor-ratings"] });
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setConfirmDeleteId(null);
      toast.success("Rating deleted");
    },
    onError: (e) => toast.error(`Failed to delete rating: ${e.message}`),
  });

  const fmtDate = (r) => {
    const d = r.data?.rated_at || r.created_date;
    if (!d) return "Unknown date";
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Rating History — {subcontractor?.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-gray-500 py-4">Loading…</p>
        ) : ratings.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No ratings yet for this subcontractor.</p>
        ) : (
          <div className="space-y-3 py-1">
            <p className="text-xs text-gray-500">
              {ratings.length} rating{ratings.length === 1 ? "" : "s"}, newest first
            </p>
            {ratings.map((r, idx) => {
              const d = r.data || {};
              const rater = d.rated_by_name || d.rated_by || r.created_by || "";
              return (
                <div key={r.id} className="border rounded-lg p-3" data-testid={`row-rating-history-${idx}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <StarDisplay value={d.overall} size="sm" />
                      <span className="text-sm font-bold text-gray-800">{d.overall || 0}/5</span>
                      <span className="text-xs text-gray-400">{fmtDate(r)}</span>
                    </div>
                    {confirmDeleteId === r.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-2 text-xs"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(r.id)}
                          data-testid={`button-confirm-delete-rating-${idx}`}
                        >
                          {deleteMutation.isPending ? "Deleting…" : "Confirm"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-600 shrink-0"
                        title="Delete this rating"
                        onClick={() => setConfirmDeleteId(r.id)}
                        data-testid={`button-delete-rating-${idx}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Per-category scores */}
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    {RATING_CATEGORIES.map(cat => (
                      <div key={cat.key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                        <span>{cat.label}</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(n => (
                            <div
                              key={n}
                              className={`w-2 h-2 rounded-sm ${n <= (d[cat.key] || 0) ? "bg-yellow-400" : "bg-gray-200"}`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {(rater || d.job_name) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                      {rater && (
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {rater}</span>
                      )}
                      {d.job_name && (
                        <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {d.job_name}</span>
                      )}
                    </div>
                  )}

                  {d.notes && (
                    <p className="mt-2 text-xs text-gray-700 bg-gray-50 rounded p-2 whitespace-pre-wrap">{d.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
