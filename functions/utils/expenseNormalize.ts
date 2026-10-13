// TS mirror of lib/expenseNormalize.cjs — keep the two in lockstep.
// Per-entity schema normalization for generic records written by AI tool calls.

const EXPENSE_ALIAS_GROUPS: Array<[string, string[]]> = [
  ['vendor_name', ['vendor', 'merchant', 'payee', 'supplier', 'store']],
  ['expense_date', ['date', 'purchase_date', 'transaction_date']],
];

const ENTITY_TYPE_ALIASES: Record<string, string> = {
  expense: 'Expense', expenses: 'Expense',
  note: 'CustomerNote', notes: 'CustomerNote',
  customernote: 'CustomerNote', customernotes: 'CustomerNote',
  document: 'Document', documents: 'Document',
  communication: 'Communication', communications: 'Communication',
  workflow: 'Workflow', workflows: 'Workflow',
};

function entityTypeKey(entityType: unknown): string {
  return String(entityType || '').toLowerCase().replace(/[\s_-]/g, '');
}

export function canonicalizeGenericEntityType(entityType: unknown): any {
  return ENTITY_TYPE_ALIASES[entityTypeKey(entityType)] || entityType;
}

export function isExpenseEntity(entityType: unknown): boolean {
  const t = entityTypeKey(entityType);
  return t === 'expense' || t === 'expenses';
}

function applyAliases(out: Record<string, unknown>, groups: Array<[string, string[]]>): void {
  for (const [canonical, aliases] of groups) {
    for (const alias of aliases) {
      if (out[alias] !== undefined) {
        if (out[canonical] === undefined || out[canonical] === null || out[canonical] === '') {
          out[canonical] = out[alias];
        }
        delete out[alias];
      }
    }
  }
}

function normalizeString(out: Record<string, unknown>, field: string, fallback?: string): void {
  const value = out[field];
  if (typeof value === 'string') out[field] = value.trim();
  else if (typeof value === 'number' || typeof value === 'boolean') out[field] = String(value);
  else if (value !== undefined && value !== null) {
    if (fallback === undefined) delete out[field];
    else out[field] = fallback;
  }
}

function normalizeDate(out: Record<string, unknown>, field: string, dateOnly = false): void {
  const value = out[field];
  if (value === undefined || value === null || value === '') return;
  const parsed = new Date(value as any);
  if (Number.isNaN(parsed.getTime())) {
    delete out[field];
    return;
  }
  if (dateOnly && typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) out[field] = match[1];
  }
}

export function normalizeExpenseData(
  data: Record<string, unknown> | null | undefined,
  opts: { applyDefaults?: boolean } = {}
): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...data };

  applyAliases(out, EXPENSE_ALIAS_GROUPS);
  ['vendor_name', 'category', 'description', 'payment_method', 'reference_number', 'receipt_url', 'status']
    .forEach(field => normalizeString(out, field));

  // "$343.91" / "343.91" → 343.91
  if (typeof out.amount === 'string') {
    const parsed = parseFloat((out.amount as string).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(parsed)) out.amount = parsed;
  }

  normalizeDate(out, 'expense_date', true);

  if (opts.applyDefaults) {
    if (!out.category) out.category = 'other';
    if (!out.expense_date) out.expense_date = new Date().toISOString().slice(0, 10);
    if (!out.status) out.status = 'paid';
    if (out.tax_deductible === undefined) out.tax_deductible = true;
  }
  return out;
}

export function normalizeCustomerNoteData(data: Record<string, unknown> | null | undefined, opts: { applyDefaults?: boolean } = {}): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...data };
  applyAliases(out, [
    ['note', ['note_text', 'text', 'content', 'message']],
    ['created_at', ['created_date', 'date', 'timestamp']],
  ]);
  ['note', 'source_type', 'source_label', 'created_by', 'created_by_name'].forEach(field => normalizeString(out, field));
  normalizeDate(out, 'created_at');
  if (opts.applyDefaults) {
    if (!out.note) out.note = '';
    if (!out.source_type) out.source_type = 'lexi';
    if (!out.created_at) out.created_at = new Date().toISOString();
  }
  return out;
}

export function normalizeDocumentData(data: Record<string, unknown> | null | undefined, opts: { applyDefaults?: boolean } = {}): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...data };
  applyAliases(out, [
    ['document_name', ['name', 'title', 'filename', 'file_name']],
    ['file_url', ['url', 'document_url', 'download_url']],
    ['category', ['document_type', 'type']],
    ['description', ['summary']],
  ]);
  ['document_name', 'file_url', 'file_type', 'category', 'description', 'related_customer', 'related_project']
    .forEach(field => normalizeString(out, field));
  if (typeof out.file_size === 'string') {
    const parsed = Number(out.file_size.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) out.file_size = parsed;
  }
  if (opts.applyDefaults) {
    if (!out.document_name) out.document_name = 'Untitled document';
    if (!out.category) out.category = 'other';
    if (out.is_customer_visible === undefined) out.is_customer_visible = false;
  }
  return out;
}

export function normalizeCommunicationData(data: Record<string, unknown> | null | undefined, opts: { applyDefaults?: boolean } = {}): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...data };
  applyAliases(out, [
    ['communication_type', ['type', 'channel', 'method']],
    ['contact_name', ['customer_name', 'name']],
    ['message', ['body', 'content', 'message_body']],
    ['created_date', ['date', 'timestamp']],
  ]);
  ['communication_type', 'contact_name', 'contact_phone', 'contact_email', 'message', 'subject',
    'direction', 'status', 'sentiment', 'intent', 'outcome', 'ai_summary']
    .forEach(field => normalizeString(out, field));
  normalizeDate(out, 'created_date');
  if (opts.applyDefaults) {
    if (!out.communication_type) out.communication_type = 'other';
    if (!out.direction) out.direction = 'outbound';
    if (!out.status) out.status = 'logged';
  }
  return out;
}

export function normalizeWorkflowData(data: Record<string, unknown> | null | undefined, opts: { applyDefaults?: boolean } = {}): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...data };
  applyAliases(out, [
    ['workflow_name', ['name', 'title']],
    ['trigger_type', ['trigger', 'event_type']],
    ['actions', ['steps']],
  ]);
  ['workflow_name', 'trigger_type', 'description', 'folder', 'status'].forEach(field => normalizeString(out, field));
  normalizeDate(out, 'last_executed');
  if (out.actions !== undefined && !Array.isArray(out.actions)) out.actions = [];
  if (opts.applyDefaults) {
    if (!out.workflow_name) out.workflow_name = 'Untitled workflow';
    if (!out.trigger_type) out.trigger_type = 'manual';
    if (!out.actions) out.actions = [];
    if (out.is_active === undefined) out.is_active = true;
  }
  return out;
}

const ENTITY_NORMALIZERS: Record<string, Function> = {
  expense: normalizeExpenseData,
  customernote: normalizeCustomerNoteData,
  note: normalizeCustomerNoteData,
  document: normalizeDocumentData,
  communication: normalizeCommunicationData,
  workflow: normalizeWorkflowData,
};

export function normalizeGenericEntityData(
  entityType: unknown,
  data: Record<string, unknown> | null | undefined,
  opts?: { applyDefaults?: boolean }
): any {
  const normalizer = ENTITY_NORMALIZERS[entityTypeKey(canonicalizeGenericEntityType(entityType))];
  return normalizer ? normalizer(data, opts) : data;
}
