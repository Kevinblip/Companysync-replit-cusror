'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const staging = require('../stagingSideEffects.cjs');
const { dataDir } = require('./paths.cjs');

function fileStoreRequired(env = process.env) {
  if (staging.sideEffectsDisabled(env)) return true;
  if (String(env.SALES_AGENT_DRY_RUN || '') === '1') return true;
  if (String(env.SALES_AGENT_DB_WRITES || '') !== '1') return true;
  return false;
}

function dbWritesEnabled(env = process.env) {
  return !fileStoreRequired(env);
}

function emptyState() {
  return {
    leads: [],
    calls: [],
    bookings: [],
    messages: [],
    steps: [],
    notifications: [],
    pipelineEvents: [],
    dailySummaries: [],
  };
}

function storePath() {
  return path.join(dataDir(), 'store.json');
}

let chain = Promise.resolve();

function readState() {
  const file = storePath();
  if (!fs.existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...emptyState(), ...parsed };
  } catch (_) {
    return emptyState();
  }
}

function writeState(state) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = storePath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function update(mutator) {
  const run = chain.then(async () => {
    if (!fileStoreRequired()) {
      const err = new Error('sales db adapter is disabled until Kevin approves live writes');
      err.code = 'SALES_DB_DISABLED';
      throw err;
    }
    const state = readState();
    const result = await mutator(state);
    writeState(state);
    return result === undefined ? state : result;
  });
  chain = run.then(() => {}, () => {});
  return run;
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function setStage(state, lead, stage, reason) {
  if (!lead) return;
  if (lead.stage === stage) return;
  if (lead.stage === 'Subscribed' || lead.stage === 'Lost') return;
  const from = lead.stage || 'New';
  lead.stage = stage;
  lead.updatedAt = new Date().toISOString();
  state.pipelineEvents.push({
    id: id('pipe'),
    leadId: lead.id,
    from,
    to: stage,
    reason: reason || '',
    at: lead.updatedAt,
  });
}

module.exports = {
  fileStoreRequired,
  dbWritesEnabled,
  emptyState,
  storePath,
  readState,
  update,
  id,
  setStage,
};
