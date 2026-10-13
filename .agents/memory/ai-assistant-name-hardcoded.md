---
name: AI voice assistant name hardcoded to Alex
description: The voice assistant name (previously subscriber-configurable via system prompt regex) is now hardcoded to "Alex" everywhere.
---

Rule: The AI voice assistant name is **Alex** — hardcoded, not subscriber-configurable.

**Why:** Subscribers were changing the name in their system prompt (the regex `extractNameFromPrompt` detected it and saved it as `assistant_name`). This caused real calls to answer as "Sarah", "Marcus", etc., confusing customers and creating trust issues. "Alex" is gender-neutral and works for all companies.

**How to apply:**
- `saveMutation` in SarahSettings.jsx always writes `assistant_name: 'alex'` (name extraction removed)
- `sarahVoiceBridge.ts` hardcodes `agentName = 'Alex'` (no longer reads from system prompt)
- `queries.js` fallbacks changed from `'sarah'`/`'Sarah'` to `'alex'`/`'Alex'`
- `sync.js` fallback changed from `'Sarah'` to `'Alex'`
- DEFAULT_PROMPT updated to say "Alex" throughout
- DB `assistant_name` column default is still 'Sarah' in schema — update if recreating tables
- After any bulk update, flush `call_routing_cache` rows for affected companies or they'll serve stale 'sarah' entries until next cache refresh
