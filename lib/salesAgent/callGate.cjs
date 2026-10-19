'use strict';

// Per-call flags for Cole's phone webhook. Twilio re-requests the voice URL
// when <Connect><Stream> fails and no terminal action is returned, which
// replayed the recording notice. This map stops that on the process that
// answered the call. The file store is the backup if the process restarts.
const calls = new Map();

function row(callSid) {
  const key = String(callSid || '');
  if (!key) return null;
  let current = calls.get(key);
  if (!current) {
    current = { notice: false, apology: false, started: false, spoke: false };
    calls.set(key, current);
  }
  return current;
}

function markNotice(callSid) {
  const current = row(callSid);
  if (!current) return false;
  const already = current.notice;
  current.notice = true;
  return already;
}

function alreadyNoticed(callSid) {
  const current = calls.get(String(callSid || ''));
  return !!(current && current.notice);
}

function markStarted(callSid) {
  const current = row(callSid);
  if (current) current.started = true;
}

function markSpoke(callSid) {
  const current = row(callSid);
  if (current) current.spoke = true;
}

function heardCole(callSid) {
  const current = calls.get(String(callSid || ''));
  return !!(current && current.spoke);
}

function claimApology(callSid) {
  const current = row(callSid);
  if (!current) return true;
  if (current.spoke || current.apology) return false;
  current.apology = true;
  return true;
}

module.exports = {
  markNotice,
  alreadyNoticed,
  markStarted,
  markSpoke,
  heardCole,
  claimApology,
};
