// Shared CSV parsing for subcontractor imports (Quick Setup Smart Fill + Subcontractors page).

export const SUB_SPECIALTIES = ["Roofing", "Siding", "Windows", "Doors", "Gutters", "HVAC", "Plumbing", "Electrical", "Painting", "Flooring"];

// Minimal CSV parser that handles quoted fields with commas.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== "")) rows.push(row);
  return rows;
}

// Parse a subcontractor CSV (header row + data rows) into normalized row objects.
// Throws with a user-friendly message when the CSV is unusable.
export function parseSubcontractorCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("That CSV needs a header row plus at least one subcontractor row.");
  const header = rows[0].map(h => h.trim().toLowerCase());
  // Priority matching: try each candidate name in order, preferring an exact
  // header match over a substring match, so e.g. a "contact name" column can't
  // steal the company-name slot when a "company" column exists.
  const col = (...names) => {
    for (const n of names) {
      let idx = header.findIndex(h => h === n);
      if (idx === -1) idx = header.findIndex(h => h.includes(n) && !(n === "name" && h.includes("contact")));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const iName = col("company", "business", "name"), iContact = col("contact"), iEmail = col("email"),
    iPhone = col("phone"), iSpec = col("specialty", "trade"), iCity = col("city"), iState = col("state");
  if (iName === -1) throw new Error('Could not find a "name" or "company" column in the CSV header.');
  const parsed = rows.slice(1).map((r, i) => {
    const specRaw = iSpec >= 0 ? (r[iSpec] || "") : "";
    const specialty = specRaw.split(/[;,/|]/).map(s => s.trim())
      .map(s => SUB_SPECIALTIES.find(o => o.toLowerCase() === s.toLowerCase())).filter(Boolean);
    return {
      _key: `csv_${Date.now()}_${i}`,
      name: (r[iName] || "").trim(),
      contact_person: iContact >= 0 ? (r[iContact] || "").trim() : "",
      email: iEmail >= 0 ? (r[iEmail] || "").trim().toLowerCase() : "",
      phone: iPhone >= 0 ? (r[iPhone] || "").trim() : "",
      specialty,
      base_city: iCity >= 0 ? (r[iCity] || "").trim() : "",
      base_state: iState >= 0 ? (r[iState] || "").trim().toUpperCase().slice(0, 2) : "",
      confidence: 1,
      issues: [],
    };
  }).filter(r => r.name);
  if (!parsed.length) throw new Error("No subcontractor rows found in that CSV.");
  return parsed;
}
