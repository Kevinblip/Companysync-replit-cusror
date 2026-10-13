# Unified Customer & Lead Notes Feed

Any note written anywhere in the system automatically appears in the customer/lead profile Notes feed with a colored source badge showing origin and author.

- **CustomerNote entity**: Stored in `generic_entities` with `entity_type='CustomerNote'`. Fields: `customer_id`, `lead_id`, `company_id`, `note`, `source_type` (manual/task/build_schedule/lead/inspection/project), `source_id`, `source_label`, `created_by`, `created_by_name`, `created_at`.
- **CustomerProfile.jsx Notes tab**: Rebuilt to query `CustomerNote` entities by `customer_id`, combined with legacy JSONB `customer.customer_notes` for backward compat. Inline note entry (no browser prompt). Edit/Delete only for manual notes.
- **LeadProfile.jsx Notes section**: New card section (`id="notes-section"`) querying `CustomerNote` by `lead_id`, with Add/Edit/Delete for manual notes. Sidebar nav link included.
- **Tasks.jsx cross-post**: Task comments auto-posted to `CustomerNote` if task has `customer_id` or `lead_id` (source_type='task').
- **BuildSchedule.jsx cross-post**: Build notes create `CustomerNote` entities (source_type='build_schedule') in addition to legacy JSONB update.
