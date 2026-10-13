/**
 * Generate the next human-readable invoice number for a company.
 *
 * Long legacy suffixes came from timestamp-based numbers, not a sequential
 * invoice count. Ignore those when finding the sequence high-water mark, but
 * keep every existing value in the taken set so a new number is never reused.
 */
export function nextInvoiceNumberFrom(source, year = new Date().getFullYear()) {
  const prefix = `INV-${year}-`;
  const taken = new Set((source || []).map(invoice => invoice.invoice_number).filter(Boolean));

  let maxSeq = 0;
  for (const number of taken) {
    if (typeof number !== 'string') continue;

    const withYear = /^INV-(\d{4})-(\d+)$/.exec(number);
    if (withYear) {
      if (Number(withYear[1]) === Number(year) && withYear[2].length <= 9) {
        maxSeq = Math.max(maxSeq, Number(withYear[2]));
      }
      continue;
    }

    const legacy = /^INV-(\d+)$/.exec(number);
    if (legacy && legacy[1].length <= 9) {
      maxSeq = Math.max(maxSeq, Number(legacy[1]));
    }
  }

  let sequence = maxSeq + 1;
  let candidate = `${prefix}${String(sequence).padStart(4, '0')}`;
  const ceiling = maxSeq + 10000;
  while (taken.has(candidate) && sequence < ceiling) {
    sequence += 1;
    candidate = `${prefix}${String(sequence).padStart(4, '0')}`;
  }

  return candidate;
}
