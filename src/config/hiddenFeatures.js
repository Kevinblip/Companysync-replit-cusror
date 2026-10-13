// ─────────────────────────────────────────────────────────────────────────────
// HIDDEN FEATURES REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT THIS IS
//   A single place that lists features which are intentionally hidden from the
//   app right now but NOT deleted. The code for each feature still lives in the
//   app — it's just switched off here so it doesn't show up for users yet.
//
// HOW TO TURN A FEATURE BACK ON
//   Find its flag below and change `false` to `true`, then save. That's it —
//   the feature will reappear for CompanySync admins to preview. To ship it
//   to all customers, the gate in the component also needs to be removed.
//   To hide it again, change it back to `false`.
//
//   true  = PREVIEW — visible only to CompanySync platform admins
//   false = HIDDEN  — invisible to everyone, kept in code for later
//
// IMPORTANT: This file exports a plain static object. The actual platform-admin
// gate lives in src/hooks/useHiddenFeatures.js — every component must import
// that hook and call `const HIDDEN_FEATURES = useHiddenFeatures();` instead of
// importing this file directly. The hook returns all `true` flags as `false`
// when the logged-in user is not a CompanySync admin.
//
// Each flag below has a short note: what it is, where it lives, and why it's off.
// ─────────────────────────────────────────────────────────────────────────────

export const HIDDEN_FEATURES = {
  // AI Estimator → satellite/map view → the purple "Generate 3D Aerial Video"
  // button (and the video popup it opens). Hidden until the aerial video feature
  // is ready to ship.
  AI_ESTIMATOR_AERIAL_VIDEO: true,

  // AI Estimator → satellite/map view → the small bottom-left N/E/S/W box that
  // opens the "all 4 sides" Street View panel. Shown — user wants this visible.
  AI_ESTIMATOR_QUAD_VIEW: true,

  // AI Estimator → satellite/map view → the floating imagery picker
  // (Default / Clear / Winter / Recent). Shown: it now uses the same shared
  // control as the manual drawing map (src/lib/mapImagery.js), so Winter
  // imagery — the one that sees through summer tree canopy — is available on
  // the auto flow too.
  AI_ESTIMATOR_IMAGERY_PICKER: true,

  // XactimateEstimateView → "Export to Xactimate" button that produces a
  // plain-XML .esx file. Hidden because the current output is not a valid
  // Xactimate ZIP package and is rejected by Xactimate on import. Symbility
  // export is unaffected. Re-enable once the export format is corrected.
  XACTIMATE_ESX_EXPORT: false,

  // Storm Tracker → the green "Get REAL Leads" button on each storm card that
  // navigates to the PropertyDataImporter. Hidden now that the built-in
  // Addresses panel (Overpass city-boundary lookup) covers the same need
  // without leaving the Storm Tracker. Re-enable if PropertyDataImporter
  // enrichment (owner names, phone numbers, etc.) is needed.
  STORM_GET_REAL_LEADS: false,

  // EstimateEditor → the green "Describe & Generate" button that opens the
  // voice-to-estimate panel (setShowVoiceEstimate). Hidden on owner request.
  // Re-enable by flipping this to true.
  ESTIMATE_DESCRIBE_AND_GENERATE: false,

  // AI Tools → Permit Assistant navigation tab. Hidden on request while the
  // underlying page remains available for a future re-enable.
  PERMIT_ASSISTANT: false,

  // Customer/Lead profile → Color Visualizer section (AI house color previews).
  // true  = visible (default — feature is released)
  // false = kill-switch: hides the section globally if the feature needs to be
  //         temporarily disabled without a code deploy. Import HIDDEN_FEATURES
  //         directly (not via the hook) in profile pages so the kill-switch
  //         applies to ALL users, not just admins.
  COLOR_VISUALIZER: true,
};
