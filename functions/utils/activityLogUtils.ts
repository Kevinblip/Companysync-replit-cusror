export interface ActivityEvent {
  timestamp: string;
  module: string;
  action: string;
  description: string;
  actor?: string;
}

export async function fetchActivityLog(
  base44: any,
  companyId: string,
  limit: number = 20,
  moduleFilter?: string
): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];

  const safeFilter = async (entity: any, query: object, sort: string, count: number): Promise<any[]> => {
    try {
      const result = await entity.filter(query, sort, count);
      return Array.isArray(result) ? result : [];
    } catch (e) {
      return [];
    }
  };

  const baseQuery = { company_id: companyId };

  if (!moduleFilter || moduleFilter === 'leads') {
    const leads = await safeFilter(base44.asServiceRole.entities.Lead, baseQuery, '-created_date', 100);
    for (const l of leads) {
      if (!l.created_date) continue;
      events.push({
        timestamp: l.created_date,
        module: 'Leads',
        action: 'Lead Added',
        description: `New lead: ${l.name || l.customer_name || 'Unknown'} (${l.status || 'New'})${l.source ? ' via ' + l.source : ''}`,
        actor: l.created_by,
      });
    }
  }

  if (!moduleFilter || moduleFilter === 'communications') {
    const comms = await safeFilter(base44.asServiceRole.entities.Communication, baseQuery, '-created_date', 100);
    for (const c of comms) {
      if (!c.created_date) continue;
      const direction = c.direction === 'inbound' ? 'received' : 'sent';
      const type = (c.type || 'message').toUpperCase();
      const contact = c.contact_name || c.to_number || c.from_number || 'Unknown';
      const snippet = c.body ? ': ' + c.body.slice(0, 80) + (c.body.length > 80 ? '…' : '') : '';
      events.push({
        timestamp: c.created_date,
        module: 'Communications',
        action: `${type} ${direction}`,
        description: `${type} ${direction} ${c.direction === 'inbound' ? 'from' : 'to'} ${contact}${snippet}`,
        actor: c.created_by,
      });
    }
  }

  if (!moduleFilter || moduleFilter === 'estimates') {
    const estimates = await safeFilter(base44.asServiceRole.entities.Estimate, baseQuery, '-created_date', 100);
    for (const e of estimates) {
      if (!e.created_date) continue;
      events.push({
        timestamp: e.created_date,
        module: 'Sales',
        action: 'Estimate Created',
        description: `Estimate for ${e.customer_name || 'Unknown'} — Status: ${e.status || 'Draft'}${e.total ? ', Total: $' + Number(e.total).toLocaleString() : ''}`,
        actor: e.created_by,
      });
    }
  }

  if (!moduleFilter || moduleFilter === 'invoices') {
    const invoices = await safeFilter(base44.asServiceRole.entities.Invoice, baseQuery, '-created_date', 100);
    for (const inv of invoices) {
      if (!inv.created_date) continue;
      events.push({
        timestamp: inv.created_date,
        module: 'Billing',
        action: 'Invoice Created',
        description: `Invoice for ${inv.customer_name || 'Unknown'} — $${Number(inv.amount || 0).toLocaleString()} (${inv.status || 'Draft'})`,
        actor: inv.created_by,
      });
    }
  }

  if (!moduleFilter || moduleFilter === 'tasks') {
    const tasks = await safeFilter(base44.asServiceRole.entities.Task, baseQuery, '-created_date', 100);
    for (const t of tasks) {
      if (!t.created_date) continue;
      events.push({
        timestamp: t.created_date,
        module: 'Tasks',
        action: 'Task Created',
        description: `Task: "${t.title || 'Untitled'}" — ${t.status || 'Open'}${t.assigned_to ? ', assigned to ' + t.assigned_to : ''}`,
        actor: t.created_by,
      });
    }
  }

  if (!moduleFilter || moduleFilter === 'customers') {
    const customers = await safeFilter(base44.asServiceRole.entities.Customer, baseQuery, '-created_date', 100);
    for (const c of customers) {
      if (!c.created_date) continue;
      events.push({
        timestamp: c.created_date,
        module: 'Customers',
        action: 'Customer Added',
        description: `New customer: ${c.name || 'Unknown'}${c.email ? ' (' + c.email + ')' : ''}`,
        actor: c.created_by,
      });
    }
  }

  if (!moduleFilter || moduleFilter === 'workflow') {
    const execs = await safeFilter(base44.asServiceRole.entities.WorkflowExecution, baseQuery, '-created_date', 50);
    for (const w of execs) {
      if (!w.created_date) continue;
      events.push({
        timestamp: w.created_date,
        module: 'Automation',
        action: 'Workflow Executed',
        description: `Workflow "${w.workflow_name || 'Unknown'}" ran — ${w.status || 'completed'}`,
        actor: 'System',
      });
    }
  }

  events.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return tb - ta;
  });

  return events.slice(0, limit);
}

export function formatActivityLogForPrompt(events: ActivityEvent[]): string {
  if (!events.length) return '(No recent activity found)';
  return events.map(e => {
    const when = new Date(e.timestamp).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const actor = e.actor && e.actor !== 'System' ? ` by ${e.actor}` : '';
    return `• [${e.module}] ${when}${actor} — ${e.description}`;
  }).join('\n');
}
