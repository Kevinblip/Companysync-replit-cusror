'use strict';

// Convert a YYYY-MM-DD wall-clock time in an IANA zone to UTC without relying
// on the server's timezone or on today's DST offset.
function assertBuildDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('build_date must be a valid YYYY-MM-DD date');
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) throw new Error('build_date must be a valid YYYY-MM-DD date');
  return { y, m, d };
}

function zonedBuildInstant(buildDate, hour, timezone = 'America/New_York') {
  const { y, m, d } = assertBuildDate(buildDate);
  const target = Date.UTC(y, m - 1, d, hour, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let instant = target;
  // Two passes handle DST transitions on the requested date (not today's).
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(instant))
      .filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
    const observedWall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    instant += target - observedWall;
  }
  return new Date(instant).toISOString();
}

function buildDayRange(buildDate, timezone) {
  return { start_time: zonedBuildInstant(buildDate, 7, timezone), end_time: zonedBuildInstant(buildDate, 17, timezone) };
}
module.exports = { assertBuildDate, zonedBuildInstant, buildDayRange };