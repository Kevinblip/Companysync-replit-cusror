// Client-side parsing of old-CRM CSV exports for the Data Health reconcile flow.
// Pure functions only (no React) so they can be unit-tested against real exports.

// Normalize an invoice number the same way the backend does, so matching agrees.
export const normNum = (s) =>
  String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Strip currency symbols, thousands separators and zero-width/non-breaking chars.
export const money = (v) => {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[\u200b\u00a0]/g, "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const cleanText = (s) =>
  String(s == null ? "" : s).replace(/[\u200b\u00a0]/g, " ").trim();

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

// Build [{ number, total }] from the invoices export. Dedupes by invoice number.
export function parseInvoiceTotals(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { items: [], error: "No rows found in that file." };
  const head = rows[0].map((h) => cleanText(h).toLowerCase());
  let numIdx = head.findIndex((h) => h.includes("invoice") && (h.includes("#") || h.includes("number") || h.includes("no")));
  if (numIdx < 0) numIdx = head.findIndex((h) => h.includes("invoice"));
  let amtIdx = head.findIndex((h) => h === "amount" || h === "total" || h === "total amount");
  if (amtIdx < 0) amtIdx = head.findIndex((h) => h.includes("amount") && !h.includes("tax") && !h.includes("paid"));
  if (numIdx < 0 || amtIdx < 0) return { items: [], error: "Couldn't find 'Invoice #' and 'Amount' columns in that file." };
  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const number = cleanText(rows[i][numIdx]);
    const total = money(rows[i][amtIdx]);
    const key = normNum(number);
    if (!key || total <= 0 || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    items.push({ number, total });
  }
  return { items, skipped };
}

// Read-only checks on the payments export: totals, by-year, and suspicious rows.
// Split payments (same amount, different dates) are intentionally NOT flagged.
export function verifyPayments(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: "No rows found in that file." };
  const head = rows[0].map((h) => cleanText(h).toLowerCase());
  const find = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const amtIdx = head.findIndex((h) => h === "amount") >= 0 ? head.findIndex((h) => h === "amount") : find("amount");
  if (amtIdx < 0) return { error: "Couldn't find an 'Amount' column in that file." };
  const idx = {
    num: find("payment #", "payment number", "payment no"),
    inv: find("invoice"), mode: find("mode"), txn: find("transaction"),
    cust: find("customer", "client", "name"), date: find("date"),
  };
  const recs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    recs.push({
      num: cleanText(r[idx.num] ?? ""), inv: cleanText(r[idx.inv] ?? ""), mode: cleanText(r[idx.mode] ?? ""),
      txn: cleanText(r[idx.txn] ?? ""), customer: cleanText(r[idx.cust] ?? ""),
      amount: money(r[amtIdx]), date: cleanText(r[idx.date] ?? ""),
    });
  }
  const total = recs.reduce((s, r) => s + r.amount, 0);
  const byYearMap = {};
  for (const r of recs) {
    const y = (r.date.match(/\d{4}/) || [])[0] || "—";
    if (!byYearMap[y]) byYearMap[y] = { num: 0, total: 0 };
    byYearMap[y].num++; byYearMap[y].total += r.amount;
  }
  const byYear = Object.entries(byYearMap).map(([yr, v]) => ({ yr, ...v }))
    .sort((a, b) => String(b.yr).localeCompare(String(a.yr)));
  const zero = recs.filter((r) => r.amount === 0);
  const test = recs.filter((r) => /test/i.test(r.txn) || /test/i.test(r.customer) || /test/i.test(r.mode));
  // Same-day duplicates only: same invoice + amount + SAME date appearing 2+ times.
  const groups = {};
  for (const r of recs) {
    const key = `${normNum(r.inv)}|${r.amount.toFixed(2)}|${r.date}`;
    (groups[key] = groups[key] || []).push(r);
  }
  const exactDup = Object.values(groups).filter((g) => g.length > 1 && g[0].amount > 0)
    .map((g) => ({ invoice: g[0].inv, customer: g[0].customer, amount: g[0].amount, date: g[0].date, count: g.length }));
  return { count: recs.length, total, byYear, zero, test, exactDup };
}
