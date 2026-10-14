// Spoken name for the phone receptionist.
// Kept in lockstep with lib/assistantName.cjs (the server copy).
// "sarah" is the stored settings key, not the name customers hear.

export const ASSISTANT_NAME = "Alex";

const LEGACY_NAMES = new Set(["sarah", "lexi", "assistant", "ai", "agent"]);

function isUsableAssistantName(raw) {
  const n = String(raw || "").trim();
  if (!n) return false;
  if (/^\{.*\}$/.test(n)) return false;
  if (LEGACY_NAMES.has(n.toLowerCase())) return false;
  return true;
}

export function resolveAssistantName(...candidates) {
  for (const candidate of candidates) {
    if (isUsableAssistantName(candidate)) {
      const n = String(candidate).trim();
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
  }
  return ASSISTANT_NAME;
}
