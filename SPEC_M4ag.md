# M4ag — Live output emergency stop hardening

## Goal

After a real-speaker report of persistent sound, make the live Web output stop path explicit and fail-safe without claiming that the underlying recurrence is already identified.

## Scope

- Add an always-visible `STOP SOUND` control beside the global Studio controls. Pointer-down invokes it immediately; a normal keyboard/assistive click and `Escape` use the same stop route.
- On either stop path, drain held and pending note inputs, request the existing voice reset, cancel future output-gate automation, and set the gate to zero at the current AudioContext time with `setValueAtTime`.
- After closing the gate, request `AudioContext.suspend()`. The next valid note request uses the existing `ensureAudio()` path to resume the context before it opens the gate.
- Cache-bust the HTML's CSS, module, and WASM references together as `m4ag` so the recovery page cannot silently reuse the previous safety code.

## Non-goals

- No claim that the real-speaker incident's root cause is proven or that the change alone proves speaker safety.
- No DSP, preset, parameter, patch-format, or effect-routing change.
- No automatic playback or unmute as part of loading, stopping, or reopening the page.

## Acceptance

1. `STOP SOUND` has a clear accessible name, a 44 px inherited control height, and uses the existing Filter accent over the existing dark background (measured contrast 8.93:1).
2. Source regression checks require a time-stamped output-gate zero, live-context suspension, and the visible control's panic route.
3. Current Web tests, native tests, WASM build, and whitespace checks pass.
4. A human low-volume test remains required: after opening the new `m4ag` URL, invoke `STOP SOUND` and `Esc` during a held note; neither test may be performed until the physical output is set to a safe low level.
