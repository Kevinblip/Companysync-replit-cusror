---
name: Company notification quiet hours
description: Durable behavior for suppressing overnight staff notifications without losing deferred work.
---

Company quiet hours apply to internal admin, office-staff, and rep notifications using the company's configured timezone. Customer-facing transactional messages remain unaffected.

**Why:** Overnight scheduler runs produced staff email/SMS and browser alerts around 4 a.m. Simply hiding the browser notification or stamping a reminder as sent would either leave other channels noisy or permanently lose the alert.

**How to apply:** Check quiet hours before creating or sending any internal in-app, email, SMS, sound, or browser notification. At shared email/SMS boundaries, match the recipient against the tenant's staff roster so customer-facing transactional messages remain unaffected. Persist a `deferred_until` availability time for generic internal alerts; scheduled work should otherwise skip without updating delivery/reminder timestamps so it retries after quiet hours. Overnight windows cross midnight; equal start/end means quiet all day.

**Collision lesson:** A real customer invoice number also appeared on a staff profile; three payment texts were skipped as quiet-hour staff alerts while the UI marked them "Texted." An exemption must prove the sender has access to the invoice and the destination matches its customer phone on the server; a caller-provided "customer" flag is not evidence. Every caller must inspect the send result, including successful HTTP responses with `skipped` or `success:false`, before writing request history.

**Manual-send rule:** Quiet hours exist to stop wee-hours automated and incoming-triggered staff notifications, not emails or texts a person deliberately composes and sends. A scheduled message or an automatic side effect of another action is not a manual send merely because a browser request initiated it.

**Why:** The user explicitly distinguished an intentional Send click from nighttime automation after a manual SMS was incorrectly suppressed because its number also belonged to staff.

**How to apply:** Only an authenticated company member's explicit send action can bypass staff quiet hours; keep automated/incoming paths gated. For mixed staff/customer recipient lists, never suppress a customer's transactional email just to silence the staff copy—handle recipients individually or preserve the existing behavior until that is implemented.