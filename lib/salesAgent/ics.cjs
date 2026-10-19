'use strict';

function icsEscape(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsStamp(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function buildDemoIcs({ uid, start, end, summary, description, organizerEmail, attendeeEmail, url }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CompanySync//Sales Demo//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(summary || 'CompanySync demo')}`,
    `DESCRIPTION:${icsEscape(description || '')}`,
  ];
  if (url) lines.push(`URL:${icsEscape(url)}`);
  if (organizerEmail) lines.push(`ORGANIZER:mailto:${organizerEmail}`);
  if (attendeeEmail) lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${attendeeEmail}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildDemoIcs, icsStamp };
