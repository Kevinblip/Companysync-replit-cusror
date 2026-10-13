# Action Items & Follow-Up Queue

Persistent reminders auto-created from key events: estimate sent (48h follow-up), new lead (1h follow-up), stale leads (24h+ in New status). Stored as `ActionItem` entities in `generic_entities`. Features:

- **Full UI** (`src/pages/ActionItems.jsx`): Active/Snoozed/Completed/Dismissed tabs, priority badges, urgency colors, Complete/Snooze/Dismiss actions, create dialog
- **Inline on profiles**: LeadProfile and CustomerProfile show pending action items with quick-complete
- **Dashboard widget**: Overdue count with link to Action Items page
- **Sidebar badge**: Red counter on Action Items nav for due/overdue items
- **Escalating reminders** (`processActionItemEscalation` cron, every 15min): Level 0 = in-app notification, Level 1 (2h overdue) = +email, Level 2 (6h overdue) = +SMS
- **Auto-creation**: EstimateEditor on send, Leads.jsx on create, checkStaleLeads cron
