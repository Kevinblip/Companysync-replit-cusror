'use strict';

const { dbWritesEnabled } = require('./salesStore.cjs');

// The database adapter is shipped so the live Lead / Communication /
// CalendarEvent writes have a single place to land later. It stays disabled
// on staging and until SALES_AGENT_DB_WRITES=1. Staging always wins, because
// that process is pointed at the production database.
const PLANNED_TABLES = ['leads', 'communications', 'calendar_events'];

function assertCanWrite(env = process.env) {
  if (!dbWritesEnabled(env)) {
    const err = new Error('sales db adapter disabled');
    err.code = 'SALES_DB_DISABLED';
    throw err;
  }
  const err = new Error('sales db writes are not approved');
  err.code = 'SALES_DB_NOT_APPROVED';
  throw err;
}

async function insertLead() {
  assertCanWrite();
}

async function insertCommunication() {
  assertCanWrite();
}

async function insertCalendarEvent() {
  assertCanWrite();
}

module.exports = {
  PLANNED_TABLES,
  assertCanWrite,
  insertLead,
  insertCommunication,
  insertCalendarEvent,
};
