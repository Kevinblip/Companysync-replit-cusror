export function isWithinQuietHours(quietHours, timezone, now = new Date()) {
  if (!quietHours?.enabled) return false;
  const toMinutes = (value) => {
    const [hours, minutes] = String(value || "00:00").split(":").map(Number);
    return (hours * 60) + minutes;
  };
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const current = (Number(parts.hour) * 60) + Number(parts.minute);
    const start = toMinutes(quietHours.start || "22:00");
    const end = toMinutes(quietHours.end || "07:00");
    return start === end || (start < end
      ? current >= start && current < end
      : current >= start || current < end);
  } catch (_) {
    return false;
  }
}