import { useCallback } from "react";
import { format as dateFnsFormat } from "date-fns";
import { toZonedTime, format as tzFormat } from "date-fns-tz";

const DEFAULT_TIMEZONE = "America/New_York";

export default function useCompanyTimezone(company) {
  const timezone = company?.timezone || DEFAULT_TIMEZONE;

  const formatInTz = useCallback(
    (dateInput, formatStr = "h:mm a") => {
      if (!dateInput) return "";
      try {
        let date = dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (isNaN(date.getTime())) return "";

        const dateStr = String(dateInput);
        if (
          typeof dateInput === "string" &&
          !dateStr.endsWith("Z") &&
          !dateStr.match(/[+-]\d{2}:\d{2}$/)
        ) {
          date = new Date(dateStr + "Z");
        }

        const zonedDate = toZonedTime(date, timezone);
        return dateFnsFormat(zonedDate, formatStr);
      } catch (e) {
        try {
          return dateFnsFormat(new Date(dateInput), formatStr);
        } catch {
          return "";
        }
      }
    },
    [timezone]
  );

  const formatDateTime = useCallback(
    (dateInput) => formatInTz(dateInput, "MMM d, yyyy h:mm a"),
    [formatInTz]
  );

  const formatTime = useCallback(
    (dateInput) => formatInTz(dateInput, "h:mm a"),
    [formatInTz]
  );

  const formatDate = useCallback(
    (dateInput) => formatInTz(dateInput, "MMM d, yyyy"),
    [formatInTz]
  );

  const formatRelativeDate = useCallback(
    (dateInput) => {
      if (!dateInput) return "";
      try {
        let date =
          dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (isNaN(date.getTime())) return "";

        const dateStr = String(dateInput);
        if (
          typeof dateInput === "string" &&
          !dateStr.endsWith("Z") &&
          !dateStr.match(/[+-]\d{2}:\d{2}$/)
        ) {
          date = new Date(dateStr + "Z");
        }

        const zonedDate = toZonedTime(date, timezone);
        const now = toZonedTime(new Date(), timezone);

        const isToday =
          zonedDate.getFullYear() === now.getFullYear() &&
          zonedDate.getMonth() === now.getMonth() &&
          zonedDate.getDate() === now.getDate();

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday =
          zonedDate.getFullYear() === yesterday.getFullYear() &&
          zonedDate.getMonth() === yesterday.getMonth() &&
          zonedDate.getDate() === yesterday.getDate();

        if (isToday) return `Today ${dateFnsFormat(zonedDate, "h:mm a")}`;
        if (isYesterday)
          return `Yesterday ${dateFnsFormat(zonedDate, "h:mm a")}`;
        return dateFnsFormat(zonedDate, "MMM d, h:mm a");
      } catch {
        return "";
      }
    },
    [timezone]
  );

  return {
    timezone,
    formatInTz,
    formatDateTime,
    formatTime,
    formatDate,
    formatRelativeDate,
  };
}

export function formatDateInTimezone(dateInput, timezone, formatStr = "h:mm a") {
  if (!dateInput) return "";
  const tz = timezone || DEFAULT_TIMEZONE;
  try {
    let date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return "";

    const dateStr = String(dateInput);
    if (
      typeof dateInput === "string" &&
      !dateStr.endsWith("Z") &&
      !dateStr.match(/[+-]\d{2}:\d{2}$/)
    ) {
      date = new Date(dateStr + "Z");
    }

    const zonedDate = toZonedTime(date, tz);
    return dateFnsFormat(zonedDate, formatStr);
  } catch {
    try {
      return dateFnsFormat(new Date(dateInput), formatStr);
    } catch {
      return "";
    }
  }
}
