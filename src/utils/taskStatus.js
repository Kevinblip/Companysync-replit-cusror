const TERMINAL_TASK_STATUS_KEYS = new Set([
  "complete",
  "completed",
  "done",
  "job completed/archive",
  "job completed",
  "archived",
  "archive",
  "closed",
  "cancelled",
  "canceled",
  "dismissed",
  "customer lost",
]);

function normalizeTaskStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isTerminalTaskValue(value) {
  const normalized = normalizeTaskStatus(value);
  if (!normalized) return false;

  return TERMINAL_TASK_STATUS_KEYS.has(normalized) ||
    normalized === "complete" ||
    normalized.startsWith("complete ") ||
    normalized.includes("job completed") ||
    normalized.includes("archive");
}

/**
 * Returns true only for tasks that are still actionable.
 * A task can be terminal through either its status, board column, or archive flag.
 */
export function isActiveTask(task) {
  if (!task || task.is_archived) return false;

  const status = normalizeTaskStatus(task.status);
  const column = normalizeTaskStatus(task.column);

  return !isTerminalTaskValue(status) && !isTerminalTaskValue(column);
}