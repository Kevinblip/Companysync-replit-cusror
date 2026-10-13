---
name: Google address field / typing-freeze (use custom dropdown, not the legacy widget)
description: Why the address-entry component renders its OWN suggestions dropdown via the Places prediction service instead of google.maps.places.Autocomplete
---

# Address-entry field: the one-character typing freeze

`src/components/GoogleAddressAutocomplete.jsx` powers the AI Estimator "AI
Satellite Measurement → Enter Property Address" box (used at AIEstimator
~ln 9535, and in AssignmentDialog). It must show Google address suggestions AND
let the user type without freezing.

**Hard-won lesson — the legacy `google.maps.places.Autocomplete` WIDGET froze
typing after the first character in this app, and that freeze happened with BOTH
a controlled input AND an uncontrolled input.** So "controlled vs uncontrolled"
was NOT the real cause — the legacy widget itself (it attaches to the <input> and
mutates its DOM value) is the constant whenever the freeze occurs. The user's
screenshot showed the widget's "powered by Google" dropdown returning correct
predictions, yet typing still locked up.

**Fix that works: don't use the widget at all.** Use the prediction SERVICE and
render your own dropdown with React:
- `AutocompleteService.getPlacePredictions({ input, componentRestrictions:{country:'us'}, types:['address'], sessionToken })`
  (debounced ~220ms, only after ≥3 chars) → render predictions in a React list.
- On select: `PlacesService(document.createElement('div')).getDetails({ placeId, fields:['formatted_address','geometry',...] })`
  to get coordinates; pass that `place` (has `geometry.location.lat()/lng()`) to
  `onAddressSelect(address, place)`. If getDetails fails, pass `null` and the
  consumer server-geocodes (`handleSatelliteAddressSelect` handles both paths).
- Use `onMouseDown` (not onClick) on suggestion rows so selection fires before
  input blur. Enter/Find submit the typed text for server geocode when no
  suggestion is highlighted.
- A plain controlled `useState` input is now safe (nothing external touches it),
  so it cannot freeze.

**Red herring to ignore:** a server-side Places REST call returning
`REQUEST_DENIED`. The Maps key is HTTP-referer-restricted (correct for a browser
key), so server/no-referer calls fail while in-browser calls work. Don't conclude
"Places is disabled" from that — test in the browser.

**Key-restriction caveat:** in-browser predictions only load on domains in the
key's allowed-referrers list. They work on the production domain
(getcompanysync.com) but may NOT load on the *.picard.replit.dev dev-preview
domain, so the dropdown can look empty in the preview even when the code is
correct. Verify on the real domain.

**Maps script:** AIEstimator loads `libraries=places,geometry`; the component
polls/retries until `window.google.maps.places` exists, so load order is fine.
The reusable component also loads the script when used on a page without a
page-level loader; coordinate this with a shared window loading flag so direct
page visits do not append duplicate scripts.
