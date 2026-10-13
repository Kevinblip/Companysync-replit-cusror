#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');

const files = {
  chat: fs.readFileSync('src/pages/TeamChat.jsx', 'utf8'),
  inspection: fs.readFileSync('src/pages/InspectionCapture.jsx', 'utf8'),
  dashboard: fs.readFileSync('src/pages/Dashboard.jsx', 'utf8'),
  workflowLog: fs.readFileSync('src/components/workflows/WorkflowActivityLog.jsx', 'utf8'),
  presenceTracker: fs.readFileSync('src/components/PresenceTracker.jsx', 'utf8'),
  onlineUsers: fs.readFileSync('src/components/OnlineUsersWidget.jsx', 'utf8'),
};

const checks = [
  [files.chat.includes('refetchInterval: isVisible?30_000:false'), 'conversation polling is capped at once per 30 seconds while visible'],
  [files.chat.includes('refetchInterval:isVisible&&selectedId?15_000:false'), 'active-chat message polling is capped at once per 15 seconds while visible'],
  [files.chat.includes('refetchIntervalInBackground:false'), 'chat polling pauses in background tabs'],
  [!files.inspection.includes("refetchOnMount: 'always'"), 'inspection media respects its five-minute freshness window on remount'],
  [files.dashboard.includes('refetchInterval: 2 * 60 * 1000'), 'invoice dashboard refresh is capped at once per two minutes'],
  [files.workflowLog.includes('refetchInterval: 30000'), 'workflow activity refresh is capped at once per 30 seconds'],
  [files.presenceTracker.includes('const HEARTBEAT_INTERVAL = 2 * 60 * 1000'), 'presence writes are capped at once per two minutes per signed-in browser'],
  [files.onlineUsers.includes('setInterval(fetchPresence, 2 * 60 * 1000)'), 'the shared online-user list refreshes at most once per two minutes'],
];

for (const [condition, label] of checks) {
  assert.ok(condition, label);
  console.log(`✓ ${label}`);
}

console.log(`\n${checks.length} API polling budget checks passed`);