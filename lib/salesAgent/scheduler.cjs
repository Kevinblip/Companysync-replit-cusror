'use strict';

const staging = require('../stagingSideEffects.cjs');
const { runDue } = require('./sequences.cjs');
const { maybeSendDailySummary } = require('./summary.cjs');

async function salesAgentTick(now = new Date()) {
  const due = await runDue(now);
  const summary = await maybeSendDailySummary(now);
  return { due, summary };
}

function startSalesAgentScheduler() {
  return staging.armInterval('salesAgentScheduler', () => {
    salesAgentTick().catch((err) => {
      console.error('[sales-agent] tick failed:', err.message);
    });
  }, 60 * 1000);
}

module.exports = { salesAgentTick, startSalesAgentScheduler };
