import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  UserPlus,
  DollarSign,
  MessageSquare,
  TrendingUp,
  ArrowUpDown,
  Phone,
  Mail,
  StickyNote,
  FileText,
  Award,
  ExternalLink,
  Download,
} from "lucide-react";
import { format } from "date-fns";

const PERIODS = [
  { value: "current_month", label: "Current Month" },
  { value: "last_month", label: "Last Month" },
  { value: "current_quarter", label: "Current Quarter" },
  { value: "ytd", label: "Year to Date" },
  { value: "all_time", label: "All Time" },
];

function getPeriodRange(period) {
  const now = new Date();
  if (period === "current_month") {
    return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)];
  }
  if (period === "last_month") {
    return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)];
  }
  if (period === "current_quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return [new Date(now.getFullYear(), q * 3, 1), new Date(now.getFullYear(), (q + 1) * 3, 0, 23, 59, 59, 999)];
  }
  if (period === "ytd") {
    return [new Date(now.getFullYear(), 0, 1), now];
  }
  return [new Date(0), now];
}

const WON_STATUSES = ["closed", "won"];

function entityDate(e) {
  return e?.created_date || e?.created_at || null;
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function RepPerformance() {
  const navigate = useNavigate();
  const {
    user,
    myCompany,
    isAdmin,
    effectiveUserEmail,
    staffProfiles,
    myStaffProfile,
    isPermissionsReady,
  } = useRoleBasedData();

  const [activeTab, setActiveTab] = useState("individual");
  const [selectedRepEmail, setSelectedRepEmail] = useState(null);
  const [period, setPeriod] = useState("all_time");
  const [sortKey, setSortKey] = useState("leads");
  const [sortDir, setSortDir] = useState("desc");

  // Compute the period range BEFORE the queries so we can pass it as a server-
  // side filter, avoiding the fetch-everything-then-filter-in-browser pattern.
  const [periodStart, periodEnd] = useMemo(() => getPeriodRange(period), [period]);
  const isAllTime = period === "all_time";

  // Date filter used for leads / customers / communications.
  // Skipped for "all_time" so we don't add a needlessly wide range filter.
  const createdDateFilter = isAllTime
    ? {}
    : { created_date: { $gte: periodStart.toISOString(), $lte: periodEnd.toISOString() } };

  // Payment date filter — mirrors the inPeriod() check done in collectedByRep,
  // so we pre-filter at the DB level instead of loading all-time payments.
  const paymentDateFilter = isAllTime
    ? {}
    : { payment_date: { $gte: periodStart.toISOString(), $lte: periodEnd.toISOString() } };

  // Cap: for date-filtered periods 5 000 comfortably exceeds realistic monthly
  // volumes; for all_time keep 10 000 so we don't truncate historical data.
  const queryLimit = isAllTime ? 10000 : 5000;

  // IMPORTANT: these query keys are namespaced under "rep-performance" so they
  // never collide with other pages' caches. Dashboard/Leads/etc. cache partial
  // datasets (e.g. only the 50 newest communications) under the generic
  // ['communications', companyId] key — reusing those keys here made this page
  // silently show tiny stale subsets for up to staleTime (3 min).
  //
  // Period is included in the key for leads / customers / communications / payments
  // because those queries are pre-filtered by date — switching period must trigger
  // a fresh fetch.  Invoices omit period from the key (no date filter) because
  // collectedByRep needs ALL paid invoices to attribute payments to the right rep
  // even when the invoice was issued outside the selected period.
  //
  // These 5 queries drive the Individual rep view. Team Overview uses the
  // server-side aggregation endpoint below (/api/local/rep-performance-summary)
  // so it never fetches thousands of records just to loop over all reps.
  const { data: leads = [] } = useQuery({
    queryKey: ["rep-performance", "leads", myCompany?.id, period],
    queryFn: () =>
      myCompany
        ? base44.entities.Lead.filter(
            { company_id: myCompany.id, ...createdDateFilter },
            "-created_date",
            queryLimit
          )
        : [],
    enabled: !!myCompany,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["rep-performance", "customers", myCompany?.id, period],
    queryFn: () =>
      myCompany
        ? base44.entities.Customer.filter(
            { company_id: myCompany.id, ...createdDateFilter },
            "-created_date",
            queryLimit
          )
        : [],
    enabled: !!myCompany,
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["rep-performance", "communications", myCompany?.id, period],
    queryFn: () =>
      myCompany
        ? base44.entities.Communication.filter(
            { company_id: myCompany.id, ...createdDateFilter },
            "-created_date",
            queryLimit
          )
        : [],
    enabled: !!myCompany,
  });

  // Invoices: pre-filter by status='paid' only (not by date) so that
  // collectedByRep can build repInvoiceIds across all time — a payment this
  // month for a job invoiced last year still needs to be attributed to the rep.
  // The JS-level issue_date filter in commissionByRep handles the period slice.
  const { data: invoices = [] } = useQuery({
    queryKey: ["rep-performance", "invoices", myCompany?.id],
    queryFn: () =>
      myCompany
        ? base44.entities.Invoice.filter(
            { company_id: myCompany.id, status: "paid" },
            "-issue_date",
            10000
          )
        : [],
    enabled: !!myCompany,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["rep-performance", "payments", myCompany?.id, period],
    queryFn: () =>
      myCompany
        ? base44.entities.Payment.filter(
            { company_id: myCompany.id, ...paymentDateFilter },
            "-payment_date",
            queryLimit
          )
        : [],
    enabled: !!myCompany,
  });

  // Team Overview uses a dedicated server-side aggregation endpoint.
  // The server runs the same per-rep attribution logic and returns only compact
  // summary rows — the browser never receives raw lead/communication records for
  // every rep in the company. Disabled for non-admins (they can't see the team tab).
  const { data: teamSummaryData, isLoading: teamSummaryLoading } = useQuery({
    queryKey: ["rep-performance", "team-summary", myCompany?.id, period],
    queryFn: async () => {
      if (!myCompany) return { rows: [] };
      const params = new URLSearchParams({ company_id: myCompany.id, period });
      const res = await fetch(`/api/local/rep-performance-summary?${params}`);
      if (!res.ok) throw new Error(`Team summary failed: ${res.status}`);
      return res.json();
    },
    enabled: !!myCompany && isAdmin && isPermissionsReady,
    staleTime: 60_000,
  });

  // Reps this user is allowed to view: admins/owners see everyone, everyone
  // else only ever sees their own profile (mirrors useRoleBasedData's filter*
  // helpers used everywhere else in the app).
  const visibleReps = useMemo(() => {
    if (!isPermissionsReady) return [];
    if (isAdmin) return staffProfiles.filter((s) => s.user_email);
    return staffProfiles.filter((s) => s.user_email === effectiveUserEmail);
  }, [staffProfiles, isAdmin, effectiveUserEmail, isPermissionsReady]);

  const effectiveSelectedEmail = isAdmin
    ? selectedRepEmail || myStaffProfile?.user_email || effectiveUserEmail
    : effectiveUserEmail;

  const inPeriod = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    return d >= periodStart && d <= periodEnd;
  };

  // Real-world assignment data mixes identifiers: most rows use the rep's
  // email in assigned_to, but some use the rep's display name (e.g. leads
  // assigned to "Kevin Stone"). Build a lowercase identity set per rep so we
  // catch every variant, case-insensitively.
  const identitiesFor = useMemo(() => {
    const map = {};
    visibleReps.forEach((s) => {
      const ids = new Set();
      [s.user_email, s.email, s.full_name, s.name].forEach((v) => {
        if (v && String(v).trim()) ids.add(String(v).trim().toLowerCase());
      });
      map[s.user_email] = ids;
    });
    return map;
  }, [visibleReps]);

  const matchesRep = (value, identitySet) => {
    if (!value || !identitySet) return false;
    return identitySet.has(String(value).trim().toLowerCase());
  };

  // Commission math intentionally mirrors CommissionTracking.jsx exactly so the
  // numbers shown here always agree with the dedicated Commission Tracking page.
  const commissionByRep = useMemo(() => {
    const periodInvoices = invoices.filter((inv) => {
      if (!inv.issue_date || inv.status !== "paid") return false;
      const d = new Date(inv.issue_date);
      return d >= periodStart && d <= periodEnd;
    });

    const map = {};
    visibleReps.forEach((staff) => {
      let totalSales = 0;
      let totalCommission = 0;
      let invoiceCount = 0;
      const attributedInvoiceIds = [];

      periodInvoices.forEach((inv) => {
        const invTotal = parseFloat(inv.total_amount || inv.amount || 0);
        if (inv.commission_splits && inv.commission_splits.length > 0) {
          const split = inv.commission_splits.find((s) => s.user_email === staff.user_email);
          if (split) {
            const splitAmount = invTotal * (split.split_percentage / 100);
            totalSales += splitAmount;
            const rate = staff.commission_rate || 5;
            totalCommission += splitAmount * (rate / 100);
            invoiceCount++;
            attributedInvoiceIds.push(inv.id);
          }
        } else if (inv.sale_agent === staff.user_email || inv.created_by === staff.user_email) {
          totalSales += invTotal;
          const rate = staff.commission_rate || 5;
          totalCommission += invTotal * (rate / 100);
          invoiceCount++;
          attributedInvoiceIds.push(inv.id);
        }
      });

      map[staff.user_email] = { totalSales, totalCommission, invoiceCount, attributedInvoiceIds };
    });
    return map;
  }, [visibleReps, invoices, periodStart, periodEnd]);

  // Payments collected are attributed via the linked invoice's sale_agent /
  // commission_splits (there is intentionally no sales_rep column on payments,
  // see task #648 out-of-scope). Payments are filtered to the selected period
  // (by payment_date) so this stays in sync with the period picker.
  const collectedByRep = useMemo(() => {
    const map = {};
    visibleReps.forEach((staff) => {
      const ids = identitiesFor[staff.user_email];
      const repInvoiceIds = new Set(
        invoices
          .filter((inv) => {
            if (inv.commission_splits && inv.commission_splits.length > 0) {
              return inv.commission_splits.some((s) => matchesRep(s.user_email, ids));
            }
            return matchesRep(inv.sale_agent, ids) || matchesRep(inv.created_by, ids);
          })
          .map((inv) => inv.id)
      );
      const repPayments = payments.filter(
        (p) => repInvoiceIds.has(p.invoice_id) && inPeriod(p.payment_date || entityDate(p))
      );
      map[staff.user_email] = {
        totalCollected: repPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        paymentCount: repPayments.length,
      };
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReps, invoices, payments, identitiesFor, periodStart, periodEnd]);

  const repDataFor = (email) => {
    const ids = identitiesFor[email];
    const repLeads = leads.filter(
      (l) =>
        (matchesRep(l.assigned_to, ids) || (l.assigned_to_users || []).some((u) => matchesRep(u, ids))) &&
        inPeriod(entityDate(l))
    );
    const repCustomers = customers.filter(
      (c) =>
        (matchesRep(c.assigned_to, ids) || (c.assigned_to_users || []).some((u) => matchesRep(u, ids))) &&
        inPeriod(entityDate(c))
    );
    const leadIds = new Set(repLeads.map((l) => l.id));
    const customerIds = new Set(repCustomers.map((c) => c.id));

    const repCommunications = communications.filter(
      (c) =>
        (matchesRep(c.assigned_to, ids) ||
          matchesRep(c.created_by, ids) ||
          leadIds.has(c.lead_id) ||
          customerIds.has(c.customer_id)) &&
        inPeriod(entityDate(c))
    );

    // Build the breakdown from the statuses that actually exist on this rep's
    // leads (real data uses statuses like "closed" / "inspected" that a
    // hardcoded list would miss).
    const statusBreakdown = {};
    repLeads.forEach((l) => {
      const s = (l.status || "unknown").toLowerCase();
      statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
    });

    const commission = commissionByRep[email] || { totalSales: 0, totalCommission: 0, invoiceCount: 0 };
    const collected = collectedByRep[email] || { totalCollected: 0, paymentCount: 0 };

    return { repLeads, repCustomers, repCommunications, statusBreakdown, commission, collected };
  };

  // Team Overview rows come from the server-side aggregation endpoint.
  // The server does all attribution logic and returns compact per-rep summaries,
  // so we never load thousands of raw entity records into the browser just to
  // fold them into a single leaderboard table.
  const teamRows = useMemo(() => {
    const serverRows = (teamSummaryData?.rows || []).map((r) => ({
      staff: {
        user_email: r.user_email,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        commission_rate: r.commission_rate,
      },
      leads: r.leads,
      won: r.won,
      customers: r.customers,
      interactions: r.interactions,
      commission: r.commission,
      collected: r.collected,
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...serverRows].sort((a, b) => (a[sortKey] - b[sortKey]) * dir);
  }, [teamSummaryData, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const jumpToRep = (email) => {
    setSelectedRepEmail(email);
    setActiveTab("individual");
  };

  // —— Individual tab CSV export (admin-only)
  const exportIndividualCSV = () => {
    if (!selectedRep || !selectedData) return;
    const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
    const headers = [
      "Rep Name", "Email", "Period", "Leads", "Customers", "Interactions",
      "Commission", "Payments Collected", "Payment Count",
    ];
    const row = [
      selectedRep.full_name || selectedRep.user_email,
      selectedRep.user_email,
      periodLabel,
      selectedData.repLeads.length,
      selectedData.repCustomers.length,
      selectedData.repCommunications.length,
      selectedData.commission.totalCommission.toFixed(2),
      selectedData.collected.totalCollected.toFixed(2),
      selectedData.collected.paymentCount,
    ];
    const csvContent = [headers.join(","), row.map((c) => `"${c}"`).join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rep_performance_${selectedRep.user_email}_${period}_${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // —— Individual tab PDF export (admin-only)
  const exportIndividualPDF = () => {
    if (!selectedRep || !selectedData) return;
    import("jspdf").then(({ jsPDF }) => {
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
      const repName = selectedRep.full_name || selectedRep.user_email;
      const commissionRate = selectedRep.commission_rate || 5;
      const today = format(new Date(), "MMMM d, yyyy");

      // ── Colours / sizes
      const primary = [59, 130, 246];   // blue-500
      const accent  = [139, 92, 246];  // purple-500
      const green   = [34, 197, 94];
      const gray    = [107, 114, 128];
      const dark    = [17, 24, 39];
      const W = 612; // letter width in pt

      // ── Header bar
      doc.setFillColor(...primary);
      doc.rect(0, 0, W, 64, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("Rep Performance Summary", 40, 36);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Generated ${today}`, 40, 52);

      let y = 88;

      // ── Rep identity
      doc.setTextColor(...dark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(repName, 40, y);
      y += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...gray);
      doc.text(`${selectedRep.user_email}  ·  ${selectedRep.role || "Sales Rep"}  ·  ${commissionRate}% commission  ·  Period: ${periodLabel}`, 40, y);
      y += 28;

      // ── Divider
      doc.setDrawColor(...primary);
      doc.setLineWidth(1.5);
      doc.line(40, y, W - 40, y);
      y += 18;

      // ── Metric cards (2 columns)
      const metrics = [
        { label: "Leads", value: String(selectedData.repLeads.length), color: primary },
        { label: "Customers", value: String(selectedData.repCustomers.length), color: green },
        { label: "Interactions", value: String(selectedData.repCommunications.length), color: [249, 115, 22] },
        { label: "Commission", value: `$${selectedData.commission.totalCommission.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: accent },
        { label: "Payments Collected", value: `$${selectedData.collected.totalCollected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: green },
        { label: "Payment Count", value: String(selectedData.collected.paymentCount), color: gray },
      ];
      const cardW = 248, cardH = 56, gap = 16, leftMargin = 40;
      metrics.forEach((m, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = leftMargin + col * (cardW + gap);
        const cy = y + row * (cardH + 10);
        doc.setFillColor(245, 247, 255);
        doc.roundedRect(cx, cy, cardW, cardH, 6, 6, "F");
        doc.setFillColor(...m.color);
        doc.rect(cx, cy, 4, cardH, "F");
        doc.setTextColor(...gray);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(m.label, cx + 14, cy + 18);
        doc.setTextColor(...dark);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(m.value, cx + 14, cy + 40);
      });
      y += Math.ceil(metrics.length / 2) * (cardH + 10) + 20;

      // ── Lead status breakdown
      const statusEntries = Object.entries(selectedData.statusBreakdown).sort((a, b) => b[1] - a[1]);
      if (statusEntries.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...dark);
        doc.text("Lead Status Breakdown", 40, y);
        y += 14;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...gray);
        const line = statusEntries.map(([s, c]) => `${s.charAt(0).toUpperCase() + s.slice(1)}: ${c}`).join("   ·   ");
        const wrapped = doc.splitTextToSize(line, W - 80);
        doc.text(wrapped, 40, y);
        y += wrapped.length * 13 + 14;
      }

      // ── Activity feed
      if (activityFeed.length > 0) {
        // Check for page overflow before heading
        if (y > 680) { doc.addPage(); y = 48; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...dark);
        doc.text("Recent Activity (up to 25 items)", 40, y);
        y += 14;

        activityFeed.forEach((item) => {
          if (y > 720) { doc.addPage(); y = 48; }
          const dateStr = format(new Date(item.date), "MMM d, yyyy h:mm a");
          const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(...dark);
          const titleLines = doc.splitTextToSize(`[${typeLabel}] ${item.title}`, W - 160);
          doc.text(titleLines, 40, y);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...gray);
          doc.text(dateStr, W - 40, y, { align: "right" });
          y += titleLines.length * 11;
          if (item.detail) {
            const detailLines = doc.splitTextToSize(item.detail, W - 80);
            doc.setFontSize(8);
            doc.text(detailLines, 40, y);
            y += detailLines.length * 10;
          }
          y += 6;
          doc.setDrawColor(229, 231, 235);
          doc.setLineWidth(0.5);
          doc.line(40, y, W - 40, y);
          y += 8;
        });
      }

      // ── Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...gray);
        doc.text(`Page ${i} of ${pageCount}  ·  Confidential — for internal use only`, 40, 780);
      }

      doc.save(`rep_performance_${selectedRep.user_email}_${period}_${format(new Date(), "yyyy-MM-dd")}.pdf`);
    });
  };

  // —— Team Overview PDF export (admin-only)
  const exportTeamPDF = () => {
    if (!teamRows.length) return;
    import("jspdf").then(({ jsPDF }) => {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
      const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
      const today = format(new Date(), "MMMM d, yyyy");

      const primary = [59, 130, 246];
      const gray    = [107, 114, 128];
      const dark    = [17, 24, 39];
      const W = 792; // landscape letter width

      // ── Header bar
      doc.setFillColor(...primary);
      doc.rect(0, 0, W, 56, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Team Performance Overview", 40, 30);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Period: ${periodLabel}  ·  Generated ${today}`, 40, 46);

      let y = 76;

      // ── Table header
      const cols = [
        { label: "Rep", x: 40, w: 180, align: "left" },
        { label: "Email", x: 220, w: 160, align: "left" },
        { label: "Leads", x: 380, w: 60, align: "right" },
        { label: "Closed", x: 440, w: 60, align: "right" },
        { label: "Customers", x: 500, w: 70, align: "right" },
        { label: "Interactions", x: 570, w: 80, align: "right" },
        { label: "Commission", x: 650, w: 80, align: "right" },
        { label: "Collected", x: 730, w: 62, align: "right" },
      ];

      doc.setFillColor(243, 244, 246);
      doc.rect(40, y, W - 80, 22, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...gray);
      cols.forEach((c) => {
        const tx = c.align === "right" ? c.x + c.w : c.x;
        doc.text(c.label.toUpperCase(), tx, y + 15, { align: c.align });
      });
      y += 22;

      // ── Table rows
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      teamRows.forEach((row, i) => {
        if (y > 520) { doc.addPage(); y = 40; }
        if (i % 2 === 0) {
          doc.setFillColor(249, 250, 251);
          doc.rect(40, y, W - 80, 20, "F");
        }
        doc.setTextColor(...dark);
        const name = row.staff.full_name || row.staff.user_email;
        doc.text(doc.splitTextToSize(name, 175)[0], 40, y + 14);
        doc.setTextColor(...gray);
        doc.text(doc.splitTextToSize(row.staff.user_email, 155)[0], 220, y + 14);
        doc.setTextColor(...dark);
        doc.text(String(row.leads), 440, y + 14, { align: "right" });
        doc.text(String(row.won), 500, y + 14, { align: "right" });
        doc.text(String(row.customers), 570, y + 14, { align: "right" });
        doc.text(String(row.interactions), 650, y + 14, { align: "right" });
        doc.text(`$${row.commission.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 730, y + 14, { align: "right" });
        doc.text(`$${row.collected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 792, y + 14, { align: "right" });
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.4);
        doc.line(40, y + 20, W - 40, y + 20);
        y += 20;
      });

      // ── Totals row
      y += 4;
      doc.setFillColor(...primary);
      doc.rect(40, y, W - 80, 22, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      const totalCommission = teamRows.reduce((s, r) => s + r.commission, 0);
      const totalCollected  = teamRows.reduce((s, r) => s + r.collected, 0);
      const totalLeads      = teamRows.reduce((s, r) => s + r.leads, 0);
      const totalWon        = teamRows.reduce((s, r) => s + r.won, 0);
      const totalCustomers  = teamRows.reduce((s, r) => s + r.customers, 0);
      const totalInteractions = teamRows.reduce((s, r) => s + r.interactions, 0);
      doc.text("TOTALS", 40, y + 15);
      doc.text(String(totalLeads), 440, y + 15, { align: "right" });
      doc.text(String(totalWon), 500, y + 15, { align: "right" });
      doc.text(String(totalCustomers), 570, y + 15, { align: "right" });
      doc.text(String(totalInteractions), 650, y + 15, { align: "right" });
      doc.text(`$${totalCommission.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 730, y + 15, { align: "right" });
      doc.text(`$${totalCollected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 792, y + 15, { align: "right" });

      // ── Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...gray);
        doc.text(`Page ${i} of ${pageCount}  ·  Confidential — for internal use only`, 40, 560);
      }

      doc.save(`team_performance_${period}_${format(new Date(), "yyyy-MM-dd")}.pdf`);
    });
  };

  // —— Team Overview CSV export (admin-only)
  const exportTeamCSV = () => {
    const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
    const headers = [
      "Rep Name", "Email", "Period", "Leads", "Closed Leads", "Customers",
      "Interactions", "Commission", "Collected",
    ];
    const rows = teamRows.map((r) => [
      r.staff.full_name || r.staff.user_email,
      r.staff.user_email,
      periodLabel,
      r.leads,
      r.won,
      r.customers,
      r.interactions,
      r.commission.toFixed(2),
      r.collected.toFixed(2),
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((c) => `"${c}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team_performance_${period}_${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const selectedRep = visibleReps.find((s) => s.user_email === effectiveSelectedEmail);
  const selectedData = effectiveSelectedEmail ? repDataFor(effectiveSelectedEmail) : null;

  const activityFeed = useMemo(() => {
    if (!selectedData) return [];
    const items = [];
    selectedData.repCommunications.forEach((c) => {
      items.push({
        date: c.created_at || c.created_date,
        type: c.communication_type || c.type || "note",
        title: c.subject || c.contact_name || "Communication",
        detail: c.ai_summary || c.body || c.message || "",
        source: "Communication",
      });
    });
    selectedData.repLeads.forEach((l) => {
      items.push({
        date: l.created_date || l.created_at,
        type: "lead",
        title: `New lead: ${l.name || l.full_name || "Unnamed"}`,
        detail: l.status ? `Status: ${l.status}` : "",
        source: "Lead",
      });
    });
    return items
      .filter((i) => i.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 25);
  }, [selectedData]);

  const activityIcon = (type) => {
    if (type === "call") return <Phone className="w-4 h-4 text-blue-600" />;
    if (type === "email") return <Mail className="w-4 h-4 text-purple-600" />;
    if (type === "lead") return <UserPlus className="w-4 h-4 text-green-600" />;
    if (type === "sms" || type === "text") return <MessageSquare className="w-4 h-4 text-orange-600" />;
    return <StickyNote className="w-4 h-4 text-gray-500" />;
  };

  if (!myCompany) {
    return <div className="p-3 sm:p-6 text-gray-500">Loading...</div>;
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rep Performance</h1>
          <p className="text-gray-500 mt-1">
            {isAdmin ? "Leads, customers, interactions, and commissions for each sales rep." : "Your leads, customers, interactions, and commissions."}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate(createPageUrl("CommissionTracking"))}>
          <ExternalLink className="w-4 h-4 mr-2" />
          Full Commission Report
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList>
            <TabsTrigger value="individual" data-testid="tab-individual">Individual</TabsTrigger>
            {isAdmin && <TabsTrigger value="team" data-testid="tab-team">Team Overview</TabsTrigger>}
          </TabsList>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-48" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="individual" className="space-y-6 mt-4">
          {isAdmin && (
            <Select value={effectiveSelectedEmail || ""} onValueChange={setSelectedRepEmail}>
              <SelectTrigger className="w-72" data-testid="select-rep">
                <SelectValue placeholder="Choose a rep" />
              </SelectTrigger>
              <SelectContent>
                {visibleReps.map((s) => (
                  <SelectItem key={s.user_email} value={s.user_email}>
                    {s.full_name || s.user_email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!selectedRep && (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                No staff profile found for this account yet.
              </CardContent>
            </Card>
          )}

          {selectedRep && selectedData && (
            <>
              <div className="flex items-center gap-3">
                {selectedRep.avatar_url ? (
                  <img src={selectedRep.avatar_url} alt={selectedRep.full_name} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                    {initials(selectedRep.full_name || selectedRep.user_email)}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-lg text-gray-900" data-testid="text-rep-name">
                    {selectedRep.full_name || selectedRep.user_email}
                  </p>
                  <p className="text-sm text-gray-500">{selectedRep.role || "Sales Rep"} &middot; {selectedRep.commission_rate || 5}% commission</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-600">Leads</p>
                        <p className="text-2xl font-bold text-blue-600 mt-1" data-testid="text-lead-count">{selectedData.repLeads.length}</p>
                      </div>
                      <UserPlus className="w-10 h-10 text-blue-600 opacity-20" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-600">Customers</p>
                        <p className="text-2xl font-bold text-green-600 mt-1" data-testid="text-customer-count">{selectedData.repCustomers.length}</p>
                      </div>
                      <Users className="w-10 h-10 text-green-600 opacity-20" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-orange-500">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-600">Interactions</p>
                        <p className="text-2xl font-bold text-orange-600 mt-1" data-testid="text-interaction-count">{selectedData.repCommunications.length}</p>
                      </div>
                      <MessageSquare className="w-10 h-10 text-orange-600 opacity-20" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-purple-500">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-600">Commission ({PERIODS.find((p) => p.value === period)?.label})</p>
                        <p className="text-2xl font-bold text-purple-600 mt-1" data-testid="text-commission">
                          ${selectedData.commission.totalCommission.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <DollarSign className="w-10 h-10 text-purple-600 opacity-20" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {isAdmin && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={exportIndividualCSV} data-testid="button-export-individual-csv">
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportIndividualPDF} data-testid="button-export-individual-pdf">
                    <FileText className="w-4 h-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="w-4 h-4" />
                      Lead Status Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {Object.keys(selectedData.statusBreakdown).length === 0 ? (
                      <p className="text-gray-500 text-sm">No leads in this period.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(selectedData.statusBreakdown)
                          .sort((a, b) => b[1] - a[1])
                          .map(([status, count]) => (
                            <Badge key={status} variant="outline" className="capitalize">
                              {status}: {count}
                            </Badge>
                          ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Award className="w-4 h-4" />
                      Payments Collected ({PERIODS.find((p) => p.value === period)?.label})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-green-700" data-testid="text-collected">
                      ${selectedData.collected.totalCollected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{selectedData.collected.paymentCount} payments this period</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="w-4 h-4" />
                    Activity Feed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activityFeed.length === 0 ? (
                    <p className="text-gray-500 text-sm py-6 text-center">No recent activity for this rep.</p>
                  ) : (
                    <div className="space-y-3">
                      {activityFeed.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-3 pb-3 border-b last:border-0">
                          <div className="mt-0.5">{activityIcon(item.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                            {item.detail && <p className="text-xs text-gray-500 truncate">{item.detail}</p>}
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {format(new Date(item.date), "MMM d, h:mm a")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="team" className="space-y-4 mt-4">
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={exportTeamCSV} data-testid="button-export-team-csv">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportTeamPDF} data-testid="button-export-team-pdf">
                <FileText className="w-4 h-4 mr-2" />
                Export PDF
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b bg-gray-50">
                      <tr className="text-left text-xs text-gray-600 uppercase">
                        <th className="p-4 font-medium">Rep</th>
                        {[
                          { key: "leads", label: "Leads" },
                          { key: "won", label: "Closed Leads" },
                          { key: "customers", label: "Customers" },
                          { key: "interactions", label: "Interactions" },
                          { key: "commission", label: "Commission" },
                          { key: "collected", label: "Collected" },
                        ].map((col) => (
                          <th key={col.key} className="p-4 font-medium cursor-pointer select-none" onClick={() => handleSort(col.key)}>
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              <ArrowUpDown className="w-3 h-3" />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.map((row) => (
                        <tr
                          key={row.staff.user_email}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() => jumpToRep(row.staff.user_email)}
                          data-testid={`row-rep-${row.staff.user_email}`}
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              {row.staff.avatar_url ? (
                                <img src={row.staff.avatar_url} alt={row.staff.full_name} className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-semibold">
                                  {initials(row.staff.full_name || row.staff.user_email)}
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-sm">{row.staff.full_name || row.staff.user_email}</p>
                                <p className="text-xs text-gray-500">{row.staff.user_email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-gray-700">{row.leads}</td>
                          <td className="p-4 text-gray-700">{row.won}</td>
                          <td className="p-4 text-gray-700">{row.customers}</td>
                          <td className="p-4 text-gray-700">{row.interactions}</td>
                          <td className="p-4 font-semibold text-purple-600">
                            ${row.commission.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="p-4 font-semibold text-green-600">
                            ${row.collected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                      {teamSummaryLoading && (
                        <tr>
                          <td colSpan={7} className="p-12 text-center text-gray-400">Loading team data…</td>
                        </tr>
                      )}
                      {!teamSummaryLoading && teamRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-12 text-center text-gray-500">No staff members found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
