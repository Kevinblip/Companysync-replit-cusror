---
name: Mobile/Bluetooth voice capture reliability
description: Why live-voice sessions fail on a phone in a car, and the three rules that keep the failure honest and recoverable.
---

# Live voice capture on mobile / car Bluetooth

Three failure modes look identical to the user ("I tapped it and nothing happened")
but have completely different causes. Keep them distinguishable.

## Rule 0 — never pass a reconnect flag handler directly to React

**Why:** React supplies the click event as the first argument. A session starter
whose first parameter means "recovery" can treat that event as `true`, skip the
fresh-session initialization, and return immediately with no microphone prompt
or visible error.

**How to apply:** bind the button as `onClick={() => startSession()}` and reserve
the boolean argument for internal reconnect calls only.

## Rule 1 — acquire the microphone BEFORE opening the WebSocket

**Why:** if `getUserMedia` runs inside `ws.onopen`, every mic failure (denied
permission, device busy, missing device) ends by closing the socket. The socket's
close handler cannot tell a mic failure from a dropped network, so it enters the
generic reconnect loop, **overwrites the real error message** with
"disconnected, reconnecting (n/m)", burns the whole retry budget re-failing
identically, and finally reports a network problem. The user is told to check
their connection when the actual fix is a permission toggle.

**How to apply:** acquire the stream first, classify the `DOMException.name` into
actionable text (`NotAllowedError` → permission, `NotReadableError` → another app
holds the mic, `NotFoundError`/`OverconstrainedError` → device gone), and treat a
mic/pipeline failure as **terminal** — never reconnectable.

## Rule 2 — deadline `AudioContext.resume()`

**Why:** on Android Chrome `resume()` can stay pending forever when another app
(car Bluetooth stack, navigation, music) owns audio focus. It does not reject. An
unguarded `await` strands the UI on "Connecting…" with no error and no escape,
which is exactly what a user describes as "nothing happened".

**How to apply:** race it against a few-second timeout, swallow the timeout, then
let the existing `state !== 'running'` check produce a real error and return to
idle. Also do not hard-require a forced capture `sampleRate`; some Bluetooth
routes reject the constructor outright — fall back to the native rate and
downsample.

## Rule 3 — `MediaStreamTrack.onended` is the only signal for a route change

**Why:** a Bluetooth handoff (incoming call, engine start, nav prompt) ends the
mic track but leaves the WebSocket **wide open**. Nothing else notices, no
reconnect fires, and the assistant simply goes deaf mid-drive while the UI still
looks healthy. `devicechange` only tells you the device *list* changed; it does
not tell you your live track died.

**How to apply:** attach `onended` to the captured track, then retire the socket
and rebuild capture against whatever device is live now. Bound it with the
session's total-reconnect budget so a flapping route cannot loop forever.

## Teardown invariant for all of the above

Any resource acquired before the socket is up must be released on **every** early
return and catch, and the teardown must be generation-guarded: check that the
current session generation still matches before calling shared cleanup, or a
failing older attempt will tear down the newer session the user just started.

## Browser wake phrase scope

A “Hey Lexi” listener in the web app may run only while the CompanySync page is visible and the user has deliberately enabled its voice mode.

**Why:** Mobile browsers do not permit a regular website or PWA to keep recording in the background, react from the lock screen, or launch itself from a spoken phrase. Representing a foreground listener as a system-wide wake word would mislead users and risk leaving microphone capture active off-screen.

**How to apply:** Pause wake recognition on visibility loss and resume only when the visible app’s voice mode is still active. A true lock-screen wake word needs a native Android/iOS application with its platform-approved foreground/background voice service.
