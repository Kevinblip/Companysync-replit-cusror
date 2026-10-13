#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const appointmentReminders = read('functions/checkReminders.ts');
const routineDispatcher = read('functions/universalNotificationDispatcher.ts');
const invoiceReminders = read('functions/checkInvoiceReminders.ts');
const taskReminders = read('functions/checkTaskReminders.ts');
const eventChanges = read('functions/sendEventChangeNotification.ts');
const reminderPanel = read('src/components/ReminderSettingsPanel.jsx');
const settingsPage = read('src/pages/Settings.jsx');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

check(
  'appointment SMS is restricted to the one-hour interval',
  appointmentReminders.includes('const SMS_REMINDER_INTERVALS_MINUTES = new Set([60])')
    && (appointmentReminders.match(/SMS_REMINDER_INTERVALS_MINUTES\.has\(intervalMin\)/g) || []).length === 2,
);

check(
  'routine entity dispatcher is email-only',
  !routineDispatcher.includes("import { sendSMSInternal }")
    && !routineDispatcher.includes('await sendSMSInternal(')
    && routineDispatcher.includes('Routine ${notificationConfig.type} notification is email-only'),
);

check(
  'invoice reminders no longer send SMS',
  !invoiceReminders.includes("functions.invoke('sendSMS'")
    && invoiceReminders.includes('Routine overdue-invoice reminders are intentionally email + in-app'),
);

check(
  'high-priority task reminders still send urgent SMS',
  taskReminders.includes("if (task.priority === 'high')")
    && taskReminders.includes("functions.invoke('sendSMS'"),
);

check(
  'event changes still honor urgent SMS notifications',
  eventChanges.includes('if (event.send_sms_notification && companyId)')
    && eventChanges.includes("functions.invoke('sendSMS'"),
);

check(
  'calendar reminder panel presents only one-hour SMS as eligible',
  reminderPanel.includes('const SMS_ELIGIBLE_INTERVALS = new Set([60])')
    && reminderPanel.includes('disabled={!cfg.enabled || !SMS_ELIGIBLE_INTERVALS.has(iv.min)}'),
);

check(
  'settings page defaults SMS to one hour and disables other intervals',
  settingsPage.includes("{ email: true, sms: i.key === '60' }")
    && (settingsPage.match(/disabled=\{key !== '60'\}/g) || []).length === 2,
);

console.log(`\n${failed ? 'FAILED' : 'ALL PASSED'}: ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);