# SPEC M4e — Calibrated Filter Cutoff hypothesis

## Goal

Turn the reference/current brightness difference into one reviewable Filter Cutoff step:

`reference brightness + current core render → one cutoff probe → calibrated cutoff hypothesis → explicit apply → re-render and A/B`

Brightness is not Cutoff. It also depends on oscillator content, FM, noise, resonance, filter envelope, and note pitch. M4e therefore measures the current patch's local response instead of directly relabeling the brightness proxy as Hz.

## Scope

- Start calibration only after `RENDER CURRENT` has produced a valid current-core analysis.
- Support enabled LP12 and LP24 only. Preserve Filter ON, mode, resonance, key tracking, Filter EG, LFO, and Matrix values.
- Choose one probe in the needed direction: current Cutoff ×2 when the reference is brighter, or ×0.5 when it is darker, clamped to 20–20,000 Hz.
- Render the probe with the same core, note, timing, sample rate, and dry signal path. The probe is analysis-only and must never become the live patch or an A/B source.
- Estimate a target from the measured local log-frequency/log-brightness response. Refuse a suggestion when the probe response is too small or moves in the wrong direction.
- Limit one suggested step to ×0.25–×4 of the current Cutoff and the parameter range. Mark extrapolated or limited results with lower confidence.
- Treat a reference/current brightness difference within 5% as `ALIGNED`, with no apply action.
- Show `CURRENT → SUGGESTED`, reference/current/probe brightness, confidence, evidence, and `WAITING / CALIBRATING / READY / ALIGNED / UNAVAILABLE / APPLIED` in text.
- Apply only after `APPLY CUTOFF`. The existing Undo history remains the recovery path and the old A/B render becomes stale.

## Explicit non-goals

- Enabling the filter or changing its mode automatically.
- Supporting BP12, BP24, HP12, or Notch with a monotonic brightness assumption.
- Changing Resonance, Filter EG, key tracking, LFO, Matrix, oscillator, or FX values.
- Spectrum matching, multi-parameter optimization, semantic instrument recognition, upload, persistence, or network inference.
- Claiming that derivative brightness is perceptual spectral identity.

## Acceptance

1. A monotonic local probe yields a deterministic finite Cutoff within 20–20,000 Hz and the ×0.25–×4 step limit.
2. A brightness difference within 5% is `ALIGNED` and cannot be applied.
3. Filter bypass, unsupported modes, invalid metrics, a boundary with no probe room, a reversed response, and low sensitivity are unavailable without patch mutation.
4. The current patch is rendered once for A/B and at most one additional analysis-only probe is rendered for calibration.
5. Applying Cutoff is one reversible history edit, invalidates the old A/B render, and returns the next action to `RENDER CURRENT`.
6. Web tests, core tests, freestanding build, responsive design audit, and a real-browser load/render/calibrate/apply/undo loop pass.
