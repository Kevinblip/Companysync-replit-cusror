import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  Shield,
  FileText,
  AlertCircle,
  Building2,
  ClipboardCheck,
} from "lucide-react";

function money(v) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

const STATUS_CONFIG = {
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    className: "bg-green-100 text-green-800 border-green-200",
    btnActive: "bg-green-600 hover:bg-green-700 text-white",
    btnInactive: "bg-white hover:bg-green-50 text-green-700 border border-green-300",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    className: "bg-red-100 text-red-800 border-red-200",
    btnActive: "bg-red-600 hover:bg-red-700 text-white",
    btnInactive: "bg-white hover:bg-red-50 text-red-700 border border-red-300",
  },
  pending: {
    label: "Pending",
    icon: MinusCircle,
    className: "bg-gray-100 text-gray-700 border-gray-200",
    btnActive: "bg-gray-500 hover:bg-gray-600 text-white",
    btnInactive: "bg-white hover:bg-gray-50 text-gray-600 border border-gray-300",
  },
};

function LineItemRow({ item, index, review, onChange, submitted }) {
  const status = review?.status || "pending";
  const comment = review?.comment || "";

  return (
    <div
      data-testid={`row-line-item-${index}`}
      className={`rounded-lg border p-4 transition-all ${
        status === "approved"
          ? "border-green-200 bg-green-50"
          : status === "rejected"
          ? "border-red-200 bg-red-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {item.code && (
              <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                {item.code}
              </span>
            )}
            {item.category && (
              <span className="text-xs text-gray-500">{item.category}</span>
            )}
          </div>
          <p className="font-medium text-gray-900 leading-snug">
            {item.description || item.name || `Line Item ${index + 1}`}
          </p>
          {item.long_description && (
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">{item.long_description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-600">
            {item.quantity != null && (
              <span>
                Qty: <strong>{item.quantity}</strong>
                {item.unit ? ` ${item.unit}` : ""}
              </span>
            )}
            {item.unit_price != null && (
              <span>
                Rate: <strong>{money(item.unit_price)}</strong>
              </span>
            )}
            {item.rcv != null && (
              <span>
                RCV: <strong>{money(item.rcv)}</strong>
              </span>
            )}
            {item.acv != null && item.acv !== item.rcv && (
              <span>
                ACV: <strong>{money(item.acv)}</strong>
              </span>
            )}
          </div>
        </div>

        {!submitted && (
          <div className="flex gap-2 shrink-0">
            <button
              data-testid={`button-approve-item-${index}`}
              onClick={() => onChange(index, "approved", comment)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
                status === "approved"
                  ? STATUS_CONFIG.approved.btnActive
                  : STATUS_CONFIG.approved.btnInactive
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve
            </button>
            <button
              data-testid={`button-reject-item-${index}`}
              onClick={() => onChange(index, "rejected", comment)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
                status === "rejected"
                  ? STATUS_CONFIG.rejected.btnActive
                  : STATUS_CONFIG.rejected.btnInactive
              }`}
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </div>
        )}

        {submitted && (
          <div className="shrink-0">
            <Badge
              className={`${STATUS_CONFIG[status]?.className || STATUS_CONFIG.pending.className} border`}
            >
              {STATUS_CONFIG[status]?.label || "Pending"}
            </Badge>
          </div>
        )}
      </div>

      {(status === "rejected" || comment) && !submitted && (
        <div className="mt-3">
          <Textarea
            data-testid={`input-comment-item-${index}`}
            placeholder={
              status === "rejected"
                ? "Reason for rejection (required)…"
                : "Optional comment…"
            }
            value={comment}
            onChange={(e) => onChange(index, status, e.target.value)}
            rows={2}
            className="text-sm resize-none"
          />
        </div>
      )}

      {submitted && comment && (
        <p className="mt-2 text-sm text-gray-600 italic border-t border-gray-200 pt-2">
          Comment: {comment}
        </p>
      )}
    </div>
  );
}

export default function AdjusterReview() {
  const params = new URLSearchParams(window.location.search);
  const reviewId = params.get("id");

  const [loading, setLoading] = useState(true);
  const [reviewData, setReviewData] = useState(null);
  const [error, setError] = useState(null);
  const [lineReviews, setLineReviews] = useState([]);
  const [overallComment, setOverallComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!reviewId) {
      setError("Invalid review link. Please check the link from your email.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const result = await base44.functions.invoke("getEstimateLineReview", { id: reviewId });
        const payload = result?.data ?? result;
        if (payload?.error) {
          setError(payload.error);
        } else if (payload?.review) {
          setReviewData(payload.review);
          const lineItems = payload.review.line_items || [];
          const existingReviews = payload.review.line_item_reviews || [];
          setLineReviews(
            lineItems.map((_, idx) => existingReviews[idx] || { status: "pending", comment: "" })
          );
          if (payload.review.overall_status === "submitted") {
            setSubmitted(true);
            setOverallComment(payload.review.overall_comment || "");
          }
        } else {
          setError("Review session not found.");
        }
      } catch (err) {
        setError("Failed to load review: " + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [reviewId]);

  const handleLineReviewChange = (index, status, comment) => {
    setLineReviews((prev) => {
      const next = [...prev];
      next[index] = { status, comment };
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!reviewId) return;
    const rejectedWithoutComment = lineReviews.some(
      (r, i) => r.status === "rejected" && !r.comment?.trim()
    );
    if (rejectedWithoutComment) {
      alert("Please provide a reason for each rejected line item.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await base44.functions.invoke("submitEstimateLineReview", {
        id: reviewId,
        line_item_reviews: lineReviews,
        overall_comment: overallComment.trim(),
      });
      const submitPayload = result?.data ?? result;
      if (submitPayload?.error) {
        alert("Submission failed: " + submitPayload.error);
      } else {
        setSubmitted(true);
      }
    } catch (err) {
      alert("Submission failed: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-gray-500">Loading review…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-6">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Review Not Available</h2>
          <p className="text-gray-500 text-sm">{error}</p>
        </Card>
      </div>
    );
  }

  if (!reviewData) return null;

  const lineItems = reviewData.line_items || [];
  const approvedCount = lineReviews.filter((r) => r.status === "approved").length;
  const rejectedCount = lineReviews.filter((r) => r.status === "rejected").length;
  const pendingCount = lineReviews.filter((r) => r.status === "pending").length;
  const allReviewed = pendingCount === 0;
  const totalRcv = lineItems.reduce((sum, i) => sum + (parseFloat(i.rcv) || 0), 0);
  const approvedRcv = lineItems.reduce((sum, i, idx) => {
    return sum + (lineReviews[idx]?.status === "approved" ? (parseFloat(i.rcv) || 0) : 0);
  }, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-gradient-to-r from-blue-800 to-blue-600 text-white px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Shield className="w-6 h-6" />
            <span className="text-sm font-medium opacity-80">Insurance Adjuster Review</span>
          </div>
          <h1 className="text-2xl font-bold">
            {reviewData.estimate_title || `Estimate #${reviewData.estimate_number || ""}`}
          </h1>
          <div className="flex flex-wrap gap-4 mt-3 text-sm opacity-90">
            {reviewData.adjuster_name && (
              <span>Adjuster: <strong>{reviewData.adjuster_name}</strong></span>
            )}
            {reviewData.claim_number && (
              <span>Claim #: <strong>{reviewData.claim_number}</strong></span>
            )}
            {reviewData.company_name && (
              <span className="flex items-center gap-1">
                <Building2 className="w-4 h-4" />{reviewData.company_name}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {submitted ? (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6 text-center">
              <ClipboardCheck className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-green-800 mb-2">Review Submitted</h2>
              <p className="text-green-700 text-sm mb-4">
                Your review has been recorded. The contractor will be notified.
              </p>
              <div className="flex justify-center gap-6 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-700">{approvedCount}</div>
                  <div className="text-green-600">Approved</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-700">{rejectedCount}</div>
                  <div className="text-red-600">Rejected</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-700">{money(approvedRcv)}</div>
                  <div className="text-blue-600">Approved RCV</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-blue-800">
                Review each line item below. Click <strong>Approve</strong> or <strong>Reject</strong> for each one, then submit your review at the bottom. Rejected items require a comment.
              </p>
              <div className="flex flex-wrap gap-4 mt-3 text-sm font-medium">
                <span className="text-green-700">{approvedCount} Approved</span>
                <span className="text-red-700">{rejectedCount} Rejected</span>
                <span className="text-gray-600">{pendingCount} Pending</span>
                <span className="ml-auto text-gray-700">Total RCV: {money(totalRcv)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {lineItems.map((item, idx) => (
            <LineItemRow
              key={idx}
              item={item}
              index={idx}
              review={lineReviews[idx]}
              onChange={handleLineReviewChange}
              submitted={submitted}
            />
          ))}
        </div>

        {lineItems.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-gray-500">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No line items found in this estimate.</p>
            </CardContent>
          </Card>
        )}

        {!submitted && (
          <>
            <Separator />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Overall Comments (Optional)</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  data-testid="input-overall-comment"
                  placeholder="Any overall comments or notes for the contractor…"
                  value={overallComment}
                  onChange={(e) => setOverallComment(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </CardContent>
            </Card>

            <div className="pb-8">
              <Button
                data-testid="button-submit-review"
                onClick={handleSubmit}
                disabled={submitting || lineItems.length === 0}
                className={`w-full py-6 text-base font-semibold ${
                  allReviewed
                    ? "bg-blue-700 hover:bg-blue-800 text-white"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                {submitting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Submitting…</>
                ) : (
                  <><ClipboardCheck className="w-5 h-5 mr-2" />
                    {allReviewed ? "Submit Review" : `Submit Review (${pendingCount} item${pendingCount !== 1 ? "s" : ""} still pending)`}
                  </>
                )}
              </Button>
              {!allReviewed && (
                <p className="text-center text-xs text-gray-500 mt-2">
                  You can submit with pending items — they will be treated as approved.
                </p>
              )}
            </div>
          </>
        )}

        {submitted && overallComment && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-gray-600">
                <strong>Your overall comment:</strong> {overallComment}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-xs text-gray-400 pb-6">
          {reviewData?.company_name || 'Your roofing contractor'} · This link is private and intended for the named adjuster only.
        </div>
      </div>
    </div>
  );
}
