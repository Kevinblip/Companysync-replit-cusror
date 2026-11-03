# Meta Business Manager checklist (ops)

Do these in Meta Events Manager / Business Manager (requires Kevin or Rad login):

1. Confirm Pixel **2301170120401803** is claimed by the CompanySync BM.
2. Generate a **Conversions API** access token for that Pixel; store as Railway env `META_CAPI_TOKEN` (preview first, then prod). Do **not** commit the token.
3. In Test Events, run a signup on a preview URL and confirm:
   - Browser: `PageView`, `CompleteRegistration`, `StartTrial` (matching `event_id`)
   - Server: same events via CAPI with EMQ fields (em, external_id, fbp/fbc, client_ip_address, client_user_agent)
4. After a first real paid SaaS invoice (non-Connect), confirm `Subscribe` + `Purchase` with shared invoice-based event ids.
5. Domain verification for `getcompanysync.com` if not already done.
6. Optional later: wire Stape/ss.getcompanysync.com CAPI tags; this PR prefers direct CAPI so missing Stape tags do not block attribution.
