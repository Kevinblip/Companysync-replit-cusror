/**
 * Lexi Tool Handlers - Modular execution functions for each tool
 * Separates tool logic from main chat flow for better maintainability
 */

import { log, LogLevel } from './errorHandler.js';

/**
 * Diagnostic tool - checks system data integrity
 */
export async function handleDiagnostic(base44, actualCompanyId, user) {
  log(LogLevel.INFO, 'lexiToolHandlers', 'Running diagnostic');
  
  const diagnosticResponse = await base44.functions.invoke('lexiDiagnostic', {
    company_id: actualCompanyId,
    user_email: user.email
  });
  
  const result = diagnosticResponse.data.diagnostic;
  
  const issues = [];
  if (result.queries?.payments?.has_data_issues) {
    issues.push(result.queries.payments.issue_summary);
  }
  
  return {
    result,
    actionMessage: issues.length > 0 
      ? `Found data issues: ${issues.join(', ')}. Go to Settings → Utilities → Company Cleanup to fix.`
      : 'System check complete - all data correctly tagged'
  };
}

/**
 * Count all records across the system
 */
/**
 * Helper to fetch data from multiple companies if actualCompanyId is an array,
 * or fallback to single company ID if it's a string.
 */
async function fetchFromCompanies(base44, entity, companyIdOrIds, sort = '-created_date', limit = 10000) {
  if (Array.isArray(companyIdOrIds) && companyIdOrIds.length > 0) {
    // Fetch from ALL linked companies
    const promises = companyIdOrIds.map(id => 
      base44.asServiceRole.entities[entity].filter({ company_id: id }, sort, limit)
    );
    const results = await Promise.all(promises);
    // Flatten and deduplicate by ID
    const allItems = results.flat();
    const uniqueItems = Array.from(new Map(allItems.map(item => [item.id, item])).values());
    return uniqueItems;
  } else {
    // Fallback for single ID (or if it wasn't an array)
    return base44.asServiceRole.entities[entity].filter({ company_id: companyIdOrIds }, sort, limit);
  }
}

export async function handleCountAllRecords(base44, actualCompanyId) {
  log(LogLevel.INFO, 'lexiToolHandlers', 'Counting all records');
  
  const [customers, leads, invoices, estimates, payments, tasks, projects] = await Promise.all([
    fetchFromCompanies(base44, 'Customer', actualCompanyId),
    fetchFromCompanies(base44, 'Lead', actualCompanyId),
    fetchFromCompanies(base44, 'Invoice', actualCompanyId),
    fetchFromCompanies(base44, 'Estimate', actualCompanyId),
    fetchFromCompanies(base44, 'Payment', actualCompanyId),
    fetchFromCompanies(base44, 'Task', actualCompanyId),
    fetchFromCompanies(base44, 'Project', actualCompanyId),
  ]);

  const result = {
    customers: customers.length,
    leads: leads.length,
    invoices: invoices.length,
    estimates: estimates.length,
    payments: payments.length,
    tasks: tasks.length,
    projects: projects.length,
  };

  return {
    result,
    actionMessage: `${customers.length} customers, ${leads.length} leads, ${invoices.length} invoices, ${estimates.length} estimates, ${payments.length} payments, ${tasks.length} tasks, ${projects.length} projects`
  };
}

/**
 * Calculate total sales from all invoices
 */
export async function handleCalculateTotalSales(base44, actualCompanyId, functionArgs) {
  log(LogLevel.INFO, 'lexiToolHandlers', 'Calculating total sales from ALL invoices');

  // Use the smart fetch helper
  let invoices = await fetchFromCompanies(base44, 'Invoice', actualCompanyId);

  // Filter by date range if provided
  if (functionArgs.start_date) {
    const startDate = new Date(functionArgs.start_date);
    const endDate = functionArgs.end_date ? new Date(functionArgs.end_date) : new Date();
    // Set end date to end of day if it's just a date string
    if (functionArgs.end_date && functionArgs.end_date.length <= 10) {
      endDate.setHours(23, 59, 59, 999);
    }

    invoices = invoices.filter(inv => {
      const invDate = new Date(inv.created_date); // Use issue_date if available? Default to created_date for safety
      return invDate >= startDate && invDate <= endDate;
    });
  } else if (functionArgs.year) {
    invoices = invoices.filter(inv => {
      const invYear = new Date(inv.created_date).getFullYear();
      return invYear === functionArgs.year;
    });
  }

  const totalSales = invoices.reduce((sum, inv) => sum + (parseFloat(inv.amount) || 0), 0);
  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const paidAmount = paidInvoices.reduce((sum, inv) => sum + (parseFloat(inv.amount) || 0), 0);
  const unpaidAmount = totalSales - paidAmount;

  const result = {
    total_invoices: invoices.length,
    total_sales: totalSales,
    paid_invoices: paidInvoices.length,
    paid_amount: paidAmount,
    unpaid_amount: unpaidAmount,
    summary: `Total Sales: $${totalSales.toFixed(2)} from ${invoices.length} invoices (Paid: $${paidAmount.toFixed(2)}, Unpaid: $${unpaidAmount.toFixed(2)})`
  };

  return {
    result,
    actionMessage: `📊 Total Sales: $${totalSales.toFixed(2)} from ${invoices.length} invoices (${paidInvoices.length} paid for $${paidAmount.toFixed(2)}, ${invoices.length - paidInvoices.length} unpaid for $${unpaidAmount.toFixed(2)})`
  };
}

/**
 * Get today's calendar events
 */
export async function handleGetTodaysCalendarEvents(base44, actualCompanyId) {
  const today = new Date().toISOString().split('T')[0];
  
  // Fetch from all companies
  let events = await fetchFromCompanies(base44, 'CalendarEvent', actualCompanyId);
  
  // Filter in memory for today's date (since we can't pass complex filter to fetchFromCompanies easily without refactor)
  events = events.filter(e => {
    if (!e.start_time) return false;
    return e.start_time >= `${today}T00:00:00.000Z` && e.start_time <= `${today}T23:59:59.999Z`;
  });

  return {
    result: { events, count: events.length },
    actionMessage: `Found ${events.length} events today`
  };
}

/**
 * Get calendar events for a date range
 */
export async function handleGetCalendarEvents(base44, actualCompanyId, functionArgs) {
  const startDate = functionArgs.start_date;
  const endDate = functionArgs.end_date || startDate;
  
  let events = await fetchFromCompanies(base44, 'CalendarEvent', actualCompanyId);
  
  events = events.filter(e => {
    if (!e.start_time) return false;
    return e.start_time >= `${startDate}T00:00:00.000Z` && e.start_time <= `${endDate}T23:59:59.999Z`;
  });

  return {
    result: { events, count: events.length },
    actionMessage: `Found ${events.length} events`
  };
}

/**
 * Create a new calendar event with reminders
 */
export async function handleCreateCalendarEvent(base44, actualCompanyId, user, functionArgs) {
  log(LogLevel.INFO, 'lexiToolHandlers', 'Creating calendar event', { title: functionArgs.title });
  
  let endTime = functionArgs.end_time;
  if (!endTime && functionArgs.start_time) {
    const startDate = new Date(functionArgs.start_time);
    startDate.setHours(startDate.getHours() + 1);
    endTime = startDate.toISOString();
  }
  
  const eventData = {
    title: functionArgs.title,
    description: functionArgs.description || '',
    start_time: functionArgs.start_time,
    end_time: endTime,
    location: functionArgs.location || '',
    attendees: functionArgs.attendees || [],
    event_type: functionArgs.event_type || 'meeting',
    company_id: actualCompanyId,
    assigned_to: user.email,
    status: 'scheduled',
    send_email_notification: functionArgs.send_email_notification === false ? false : true,
    email_reminder_minutes: functionArgs.email_reminder_minutes || (functionArgs.send_email_notification === false ? undefined : [0]),
    send_browser_notification: functionArgs.send_browser_notification === false ? false : true,
    browser_reminder_minutes: functionArgs.browser_reminder_minutes || (functionArgs.send_browser_notification === false ? undefined : [0])
  };
  
  const newEvent = await base44.asServiceRole.entities.CalendarEvent.create(eventData);
  
  // Sync to Google Calendar immediately
  try {
    log(LogLevel.INFO, 'lexiToolHandlers', 'Syncing new event to Google Calendar');
    await base44.functions.invoke('syncCRMToGoogleCalendar', { eventId: newEvent.id });
  } catch (syncError) {
    log(LogLevel.WARN, 'lexiToolHandlers', 'Google Calendar sync failed', { error: syncError.message });
  }
  
  const reminderSummary = [];
  if (eventData.send_email_notification && eventData.email_reminder_minutes?.length > 0) {
    reminderSummary.push(`📧 Email: ${eventData.email_reminder_minutes.map((m) => m === 0 ? 'at event time' : `${m} min before`).join(', ')}`);
  }
  if (eventData.send_sms_notification && eventData.sms_reminder_minutes?.length > 0) {
    reminderSummary.push(`📱 SMS: ${eventData.sms_reminder_minutes.map((m) => m === 0 ? 'at event time' : `${m} min before`).join(', ')}`);
  }
  if (eventData.send_browser_notification && eventData.browser_reminder_minutes?.length > 0) {
    reminderSummary.push(`🔔 Browser: ${eventData.browser_reminder_minutes.map((m) => m === 0 ? 'at event time' : `${m} min before`).join(', ')}`);
  }
  
  const eventTime = new Date(newEvent.start_time).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  return {
    result: { event: newEvent, success: true },
    actionMessage: `✅ Created "${newEvent.title}" on ${eventTime}${reminderSummary.length > 0 ? '. Reminders: ' + reminderSummary.join(', ') : ''}`
  };
}

/**
 * Update an existing calendar event
 */
export async function handleUpdateCalendarEvent(base44, actualCompanyId, functionArgs) {
  const eventTitle = functionArgs.event_title.toLowerCase();

  const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ company_id: actualCompanyId }, '-created_date', 100);

  const matchingEvent = allEvents.find(e => 
    e.title?.toLowerCase().includes(eventTitle) ||
    eventTitle.includes(e.title?.toLowerCase() ?? '')
  );

  if (!matchingEvent) {
    return {
      result: { success: false, error: 'Event not found' },
      actionMessage: `No event found matching "${functionArgs.event_title}"`
    };
  }

  const updateData = {};

  if (functionArgs.new_start_time) updateData.start_time = functionArgs.new_start_time;
  if (functionArgs.new_end_time) updateData.end_time = functionArgs.new_end_time;
  if (functionArgs.new_title) updateData.title = functionArgs.new_title;
  if (functionArgs.new_description) updateData.description = functionArgs.new_description;

  if (functionArgs.email_reminder_minutes !== undefined) {
    updateData.email_reminder_minutes = functionArgs.email_reminder_minutes;
    updateData.send_email_notification = true;
  }
  if (functionArgs.sms_reminder_minutes !== undefined) {
    updateData.sms_reminder_minutes = functionArgs.sms_reminder_minutes;
    updateData.send_sms_notification = true;
  }
  if (functionArgs.browser_reminder_minutes !== undefined) {
    updateData.browser_reminder_minutes = functionArgs.browser_reminder_minutes;
    updateData.send_browser_notification = true;
  }

  await base44.asServiceRole.entities.CalendarEvent.update(matchingEvent.id, updateData);

  // Sync to Google Calendar
  try {
    await base44.functions.invoke('syncCRMToGoogleCalendar', { eventId: matchingEvent.id });
  } catch (syncError) {
    log(LogLevel.WARN, 'lexiToolHandlers', 'Google Calendar sync failed', { error: syncError.message });
  }

  const oldTime = matchingEvent.start_time ? new Date(matchingEvent.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'N/A';
  const newTime = updateData.start_time ? new Date(updateData.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : oldTime;

  return {
    result: { 
      success: true, 
      event_title: matchingEvent.title,
      old_time: matchingEvent.start_time,
      new_time: updateData.start_time || matchingEvent.start_time
    },
    actionMessage: `✅ Updated "${matchingEvent.title}": ${oldTime} → ${newTime}`
  };
}

/**
 * Tool handler registry - maps tool names to handler functions
 */
export const toolHandlers = {
  'run_diagnostic': handleDiagnostic,
  'count_all_records': handleCountAllRecords,
  'calculate_total_sales': handleCalculateTotalSales,
  'get_todays_calendar_events': handleGetTodaysCalendarEvents,
  'get_calendar_events': handleGetCalendarEvents,
  'create_calendar_event': handleCreateCalendarEvent,
  'update_calendar_event': handleUpdateCalendarEvent,

};