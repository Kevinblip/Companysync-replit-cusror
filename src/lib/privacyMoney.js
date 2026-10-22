// Display-only cleanup for dollar figures while impersonation privacy mode
// is on. The server already replaced real amounts; summed totals in the UI
// can still render as $0 or $NaN, and those should read as hidden too.

const MONEY_TEXT = /\$\s?-?(?:\d[\d,]*(?:\.\d+)?|NaN)\b/g;

export function scrubMoneyText(value) {
  if (typeof value !== 'string' || !value.includes('$')) return value;
  return value.replace(MONEY_TEXT, '$***');
}

export function scrubMoneyInTree(root) {
  if (!root) return;
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      const next = scrubMoneyText(node.nodeValue || '');
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
}
