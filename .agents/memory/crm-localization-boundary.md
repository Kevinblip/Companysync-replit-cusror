---
name: CRM localization boundary
description: Defines what changes language when a company or staff member selects Spanish.
---

The saved CRM language preference controls product interface labels, including authenticated onboarding and Quick Setup screens. It does not translate assistant communication or user-entered business data.

**Why:** The user explicitly wants the CRM interface in Spanish while continuing to communicate with the assistant in English. Company names, customer names, addresses, event titles, and other stored values must retain their original content.

**How to apply:** Localize hardcoded interface copy through the existing translation hook and dictionaries. Do not reset the saved language preference, alter stored records, or infer that all conversation and generated content should switch languages.