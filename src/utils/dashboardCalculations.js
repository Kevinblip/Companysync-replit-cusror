import { format } from "date-fns";

export function calcOutstandingAmount(invoices) {
  const unpaid = invoices.filter(i =>
    !i.status ||
    i.status === 'draft' ||
    i.status === 'sent' ||
    i.status === 'viewed' ||
    i.status === 'partially_paid'
  );
  return unpaid.reduce((sum, inv) => {
    const remaining = (inv.amount || 0) - (inv.amount_paid || 0);
    return sum + remaining;
  }, 0);
}

export function getUnpaidInvoices(invoices) {
  return invoices.filter(i =>
    !i.status ||
    i.status === 'draft' ||
    i.status === 'sent' ||
    i.status === 'viewed' ||
    i.status === 'partially_paid'
  );
}

export function getOverdueInvoices(invoices) {
  return invoices.filter(inv => {
    if (inv.status === 'paid' || inv.status === 'cancelled') return false;
    if (!inv.due_date) return false;
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  });
}

export function calcOverdueAmount(overdueInvoices) {
  return overdueInvoices.reduce((sum, inv) => {
    const remaining = (inv.amount || 0) - (inv.amount_paid || 0);
    return sum + remaining;
  }, 0);
}

export function calcThisYearRevenue(payments, currentYear) {
  return payments.filter(payment => {
    if (!payment.payment_date) return false;
    return new Date(payment.payment_date).getFullYear() === currentYear;
  }).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

export function calcTotalRevenue(paidInvoices) {
  return paidInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
}

export function filterByYear(items, dateField, selectedYear) {
  if (selectedYear === 'all') return items;
  return items.filter(item => {
    const d = item[dateField] || item.created_date;
    if (!d) return false;
    return new Date(d).getFullYear().toString() === selectedYear;
  });
}

export function calcInvoiceStats(yearFilteredInvoices) {
  return {
    draft: yearFilteredInvoices.filter(i => i.status === 'draft' || !i.status).length,
    sent: yearFilteredInvoices.filter(i => i.status === 'sent').length,
    partiallyPaid: yearFilteredInvoices.filter(i => i.status === 'partially_paid').length,
    overdue: yearFilteredInvoices.filter(inv => {
      if (inv.status === 'paid' || inv.status === 'cancelled') return false;
      if (!inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return dueDate < today;
    }).length,
    paid: yearFilteredInvoices.filter(i => i.status === 'paid').length,
  };
}

export function calcEstimateStats(yearFilteredEstimates) {
  return {
    draft: yearFilteredEstimates.filter(e => e.status === 'draft' || !e.status).length,
    sent: yearFilteredEstimates.filter(e => e.status === 'sent').length,
    expired: yearFilteredEstimates.filter(e => e.status === 'expired').length,
    declined: yearFilteredEstimates.filter(e => e.status === 'declined').length,
    accepted: yearFilteredEstimates.filter(e => e.status === 'accepted').length,
  };
}

export function calcProposalStats(yearFilteredProposals) {
  return {
    draft: yearFilteredProposals.filter(p => p.status === 'draft' || !p.status).length,
    sent: yearFilteredProposals.filter(p => p.status === 'sent').length,
    declined: yearFilteredProposals.filter(p => p.status === 'declined').length,
    accepted: yearFilteredProposals.filter(p => p.status === 'accepted').length,
  };
}

export function calcLeadsData(yearFilteredLeads, convertedLeads) {
  return [
    { name: 'New', value: yearFilteredLeads.filter(l => l.status === 'new').length, color: '#8b5cf6' },
    { name: 'Contacted', value: yearFilteredLeads.filter(l => l.status === 'contacted').length, color: '#3b82f6' },
    { name: 'Qualified', value: yearFilteredLeads.filter(l => l.status === 'qualified').length, color: '#f59e0b' },
    { name: 'Won', value: convertedLeads, color: '#10b981' },
    { name: 'Lost', value: yearFilteredLeads.filter(l => l.status === 'lost').length, color: '#ef4444' },
  ];
}

export function calcProjectsData(projects, projectsInProgress) {
  return [
    { name: 'Not Started', value: projects.filter(p => p.status === 'not_started').length, color: '#94a3b8' },
    { name: 'In Progress', value: projectsInProgress, color: '#3b82f6' },
    { name: 'On Hold', value: projects.filter(p => p.status === 'on_hold').length, color: '#f59e0b' },
    { name: 'Completed', value: projects.filter(p => p.status === 'completed').length, color: '#10b981' },
  ];
}

export function calcOutstandingByCustomer(invoices) {
  const map = new Map();
  (invoices || []).forEach(inv => {
    const name = inv.customer_name?.trim();
    if (!name) return;
    const remaining = (Number(inv.amount) || 0) - (Number(inv.amount_paid) || 0);
    if (inv.status !== 'paid' && inv.status !== 'cancelled' && remaining > 0) {
      map.set(name, (map.get(name) || 0) + remaining);
    }
  });
  return map;
}

export function calcCriticalTasks(tasks, outstandingByCustomer) {
  return tasks.filter(t => {
    const taskCustomer = (t.related_to || '').trim() || (t.name?.split(' - ').slice(-1)[0]?.trim() || '');
    if (taskCustomer && !(outstandingByCustomer.get(taskCustomer) > 0)) return false;
    if (t.is_archived || t.column === 'job_completed') return false;
    if (t.column === 'customer_lost') return false;

    if (t.due_date) {
      const dueDate = new Date(t.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (dueDate < today) return true;
    }

    const criticalColumns = ['not_started', 'in_progress', 'awaiting_payment', 'follow_up_needed', 'awaiting_feedback'];
    if (criticalColumns.includes(t.column)) {
      const daysSinceUpdate = Math.floor((new Date() - new Date(t.updated_date)) / (1000 * 60 * 60 * 24));
      if (daysSinceUpdate >= 5) return true;
    }

    return false;
  });
}

export function calcLast7DaysPayments(payments) {
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayName = format(date, 'EEE');
    const dayPayments = payments.filter(p => {
      if (!p.payment_date) return false;
      return format(new Date(p.payment_date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
    });
    last7Days.push({
      name: dayName,
      amount: dayPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    });
  }
  return last7Days;
}

export function calcStaffCommissions(staffProfiles, isAdmin, hasPermission, userEmail) {
  let profiles = staffProfiles;
  if (!isAdmin && !hasPermission('commission_report', 'view_global')) {
    profiles = staffProfiles.filter(s => s.user_email === userEmail);
  }

  const excludedEmails = [
    'victoriafeliciapatindol@gmail.com',
    'raffy.vpa28@gmail.com',
    'guidatorivirtuali@gmail.com',
    'luisas@base44.com',
    'rubaitradbusiness3333@gmail.com',
    'yourinsuranceclaimsnetwork@gmail.com'
  ];

  profiles = profiles.filter(s => {
    if (excludedEmails.includes(s.user_email)) return false;
    const hasCommissionRate = (s.commission_percentage || 0) > 0;
    const hasCommissionEarnings = (s.total_commissions_earned || 0) > 0;
    return hasCommissionRate || hasCommissionEarnings;
  });

  return profiles.map(staff => ({
    name: staff.full_name || staff.user_email,
    email: staff.user_email,
    total_earned: staff.total_commissions_earned || 0,
    deductions: staff.total_deductions || 0,
    net: (staff.total_commissions_earned || 0) - (staff.total_deductions || 0),
  })).sort((a, b) => b.net - a.net);
}

export function calcTaskHealthScore(tasks, criticalTasks) {
  const activeTasks = tasks.filter(t => !t.is_archived && t.column !== 'job_completed');
  const totalTasks = activeTasks.length;

  if (totalTasks === 0) return { score: 100, status: 'Excellent', color: 'green', insights: [] };

  const criticalCount = criticalTasks.length;
  const overdue = activeTasks.filter(t => {
    if (!t.due_date) return false;
    const dueDate = new Date(t.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  }).length;
  const unassigned = activeTasks.filter(t => t.column !== 'customer_lost' && !t.assignees?.length && !t.assigned_to).length;
  const highPriority = activeTasks.filter(t => t.column !== 'customer_lost' && t.priority === 'high').length;

  let score = 100;
  score -= (criticalCount / totalTasks) * 40;
  score -= (overdue / totalTasks) * 30;
  score -= (unassigned / totalTasks) * 20;
  score -= (highPriority / totalTasks) * 10;
  score = Math.max(0, Math.round(score));

  const insights = [];
  if (criticalCount > 0) insights.push(`${criticalCount} tasks need immediate attention`);
  if (overdue > 0) insights.push(`${overdue} tasks are overdue`);
  if (unassigned > 3) insights.push(`${unassigned} tasks unassigned - assign owners to improve workflow`);
  if (highPriority > 5) insights.push(`${highPriority} high priority tasks - consider redistributing workload`);

  const status = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Attention' : 'Critical';
  const color = score >= 80 ? 'green' : score >= 60 ? 'blue' : score >= 40 ? 'yellow' : 'red';

  return { score, status, color, insights };
}

export function calcAiRecommendations(criticalTasks, invoices, leads, estimates) {
  const recs = [];

  if (criticalTasks.length > 5) {
    recs.push({
      type: 'urgent',
      icon: '\u{1F6A8}',
      title: 'High Task Backlog Detected',
      action: 'Review and redistribute tasks',
      impact: 'High'
    });
  }

  const overdueInvoicesCount = invoices.filter(i => i.status === 'overdue').length;
  if (overdueInvoicesCount > 3) {
    recs.push({
      type: 'financial',
      icon: '\u{1F4B0}',
      title: `${overdueInvoicesCount} Overdue Invoices`,
      action: 'Send follow-up reminders',
      impact: 'High'
    });
  }

  const oldLeads = leads.filter(l => {
    const daysSince = Math.floor((new Date() - new Date(l.created_date)) / (1000 * 60 * 60 * 24));
    return daysSince > 14 && l.status === 'new';
  }).length;

  if (oldLeads > 10) {
    recs.push({
      type: 'opportunity',
      icon: '\u{1F3AF}',
      title: `${oldLeads} Stale Leads`,
      action: 'Follow up or archive inactive leads',
      impact: 'Medium'
    });
  }

  if (estimates.filter(e => e.status === 'sent').length > 10) {
    recs.push({
      type: 'sales',
      icon: '\u{1F4CA}',
      title: 'Multiple Pending Estimates',
      action: 'Follow up with customers for decisions',
      impact: 'Medium'
    });
  }

  if (recs.length === 0) {
    recs.push({
      type: 'success',
      icon: '\u2728',
      title: 'Everything looks great!',
      action: 'Keep up the excellent work',
      impact: 'None'
    });
  }

  return recs;
}

export function getAvailableYears(invoices, currentYear) {
  const yearsWithInvoices = [...new Set(invoices
    .filter(i => i.issue_date)
    .map(i => new Date(i.issue_date).getFullYear())
  )];
  return [...new Set([...yearsWithInvoices, currentYear])].sort((a, b) => b - a);
}
