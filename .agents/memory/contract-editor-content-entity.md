---
name: ContractEditorContent entity and signing flow
description: How contract editor edits get stored in DB and displayed to customers during signing
---

## Rule
ContractEditor saves edited content as a `ContractEditorContent` generic entity (`entity_type='ContractEditorContent'`, `company_id`, `data.template_key='contingency'`, `data.content=JSON.stringify(editedFields)`).

The `get-signing-session` endpoint (both prod-server.cjs and vite-functions-plugin.js) queries this entity by company_id and includes the content string as `template.html_content` in the response.

`sign-contract-customer.jsx` renders `ContractHtmlRenderer` when `template.html_content` is present, falling back to the PDF viewer.

**Why:** The original flow was fully disconnected — editor saved to localStorage only; customers saw the raw PDF from `original_file_url`. This bridges them via DB.

**How to apply:**
- If adding a new contract template type, add the template_key to ContractEditor and update the `tplNameLower.includes(...)` filter in both handlers.
- The ContractHtmlRenderer contains DEFAULT_CONTENT as a fallback — it mirrors ContractEditor's DEFAULT_CONTENT; keep them in sync.
- Prod DB and dev DB are separate; content saved in dev won't appear in the deployed app until a save action is done in production.
