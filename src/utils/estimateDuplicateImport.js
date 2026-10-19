function cents(value) {
  const number = typeof value === 'string' ? Number(String(value).replace(/[$,\s]/g, '')) : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

export function textSignature(value) {
  const text = String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return text.length >= 40 ? text : '';
}

export function lineItemSignature(item) {
  const description = String(item?.description ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const quantity = Number(item?.quantity);
  const unit = String(item?.unit ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const rcv = cents(item?.rcv ?? item?.amount);
  return `${description}|${Number.isFinite(quantity) ? quantity : ''}|${unit}|${rcv ?? ''}`;
}

export function sequenceSignature(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map(lineItemSignature).join('\n');
}

function sameSequence(left, right) {
  if (!left.length || left.length !== right.length) return false;
  return sequenceSignature(left) === sequenceSignature(right);
}

export const DUPLICATE_PAGE_PROMPT = `
DUPLICATE PAGES AND DOCUMENTS:
If the same page or the same document is included twice, do not extract its line items twice.
Return pages[] with page_number, the page's plain text, and that page's line_items.
Identical text or an identical line-item sequence is a duplicate and must be returned once.
`;

export function collapseDuplicateLineSequence(items = []) {
  const list = Array.isArray(items) ? [...items] : [];
  let removed = 0;

  if (list.length >= 2 && list.length % 2 === 0) {
    const half = list.length / 2;
    if (sameSequence(list.slice(0, half), list.slice(half))) {
      removed += half;
      list.splice(half);
    }
  }

  let index = 0;
  while (index < list.length) {
    let folded = false;
    const max = Math.floor((list.length - index) / 2);
    for (let size = max; size >= 2; size -= 1) {
      if (sameSequence(list.slice(index, index + size), list.slice(index + size, index + size * 2))) {
        list.splice(index + size, size);
        removed += size;
        folded = true;
        break;
      }
    }
    if (!folded) index += 1;
  }

  for (let start = 0; start < list.length; start += 1) {
    const max = Math.min(80, list.length - start);
    for (let size = max; size >= 4; size -= 1) {
      const block = list.slice(start, start + size);
      for (let cursor = start + size; cursor + size <= list.length;) {
        if (sameSequence(block, list.slice(cursor, cursor + size))) {
          list.splice(cursor, size);
          removed += size;
        } else {
          cursor += 1;
        }
      }
    }
  }

  const warning = removed > 0
    ? `Skipped ${removed} duplicate line item${removed === 1 ? '' : 's'} from a repeated page or document. They were not merged.`
    : '';
  return { lineItems: list, removedCount: removed, warning };
}

function pageRecords({ lineItems = [], pages = [], name = 'Document' } = {}) {
  const pageList = Array.isArray(pages) ? pages : [];
  const withItems = pageList.filter((page) => (page?.line_items || page?.lineItems || []).length > 0);
  if (withItems.length > 0) {
    return withItems.map((page, index) => ({
      name: page.name || `Page ${page.page_number || page.pageNumber || index + 1}`,
      text: page.text || '',
      lineItems: page.line_items || page.lineItems || [],
    }));
  }
  return [{ name, text: pageList.map((page) => page?.text || '').join('\n'), lineItems }];
}

export function dedupeImportedLineItems({ lineItems = [], pages = [], name = 'Document' } = {}) {
  const seenText = new Map();
  const seenItems = new Map();
  const kept = [];
  const skipped = [];

  for (const page of pageRecords({ lineItems, pages, name })) {
    const collapsed = collapseDuplicateLineSequence(page.lineItems);
    const textKey = textSignature(page.text);
    const itemKey = sequenceSignature(collapsed.lineItems);
    const textDup = textKey && seenText.has(textKey);
    const itemDup = itemKey && seenItems.has(itemKey);
    if (textDup || itemDup) {
      const original = textDup ? seenText.get(textKey) : seenItems.get(itemKey);
      const kind = textDup ? 'identical text' : 'identical line items';
      skipped.push({
        name: page.name,
        warning: `Skipped duplicate ${page.name} (${kind} to ${original}). It was not merged.`,
      });
      continue;
    }
    if (textKey) seenText.set(textKey, page.name);
    if (itemKey) seenItems.set(itemKey, page.name);
    kept.push(...collapsed.lineItems);
    if (collapsed.warning) skipped.push({ name: page.name, warning: collapsed.warning });
  }

  const flattened = collapseDuplicateLineSequence(kept);
  if (flattened.warning) skipped.push({ name, warning: flattened.warning });
  return {
    lineItems: flattened.lineItems,
    skipped,
    warning: skipped.map((entry) => entry.warning).filter(Boolean).join(' '),
  };
}

export function registerImportDocument({
  name,
  text = '',
  lineItems = [],
  pages = [],
  seenText,
  seenItems,
} = {}) {
  const deduped = dedupeImportedLineItems({ lineItems, pages, name });
  const textKey = textSignature(text) || textSignature((pages || []).map((page) => page?.text || '').join('\n'));
  const itemKey = sequenceSignature(deduped.lineItems);
  const textDup = textKey && seenText?.has(textKey);
  const itemDup = itemKey && seenItems?.has(itemKey);
  if (textDup || itemDup) {
    const original = textDup ? seenText.get(textKey) : seenItems.get(itemKey);
    const kind = textDup ? 'identical text' : 'identical line items';
    return {
      duplicate: true,
      lineItems: [],
      warning: `Skipped duplicate ${name} (${kind} to ${original}). It was not merged.`,
    };
  }
  if (textKey) seenText?.set(textKey, name);
  if (itemKey) seenItems?.set(itemKey, name);
  return { duplicate: false, lineItems: deduped.lineItems, warning: deduped.warning };
}
