'use strict';

// Quiet hours protect automated staff notifications, not a member's explicit
// compose/send action. A caller-supplied flag alone can never grant the bypass.
function isAuthenticatedManualSend(params, req, caller) {
  return params?.manualSend === true
    && params?.__externalCall === true
    && Boolean(req)
    && Boolean(caller?.email);
}

module.exports = { isAuthenticatedManualSend };