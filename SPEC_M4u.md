# SPEC M4u — HQ FM guard recovery

## Goal

Improve the opt-in HQ FM response that was judged substantially rounder than Legacy, without returning to Legacy's high-register folded-energy level.

## Scope

- Keep parameter 78 (`fmQuality`) and its two existing modes: `0 = Legacy`, `1 = HQ Guard`.
- Preserve the HQ guard's zero-depth cutoff when the carrier and first upper sideband already exceed 45% of the sample rate.
- Starting from the existing strict sideband-depth estimate, recover a bounded 1.5× amount of depth, capped by the requested FM value.
- Preserve the default Legacy path, parameter count, parameter IDs, UI labels, factory-preset values, C ABI, and routing.
- Increment the engine version from 16 to 17 because the opt-in HQ PCM path changes.
- Extend the disconnected AudioWorklet safety test to exercise a C8, full-FM HQ-to-Legacy parameter transition before release and panic.

## Non-goals

- No oscillator oversampling, new quality mode, automatic mode selection, preset retuning, output-gain change, or UI redesign.
- No claim that the revised HQ sound is the user's preferred production setting without a listening check.
- No change to the existing Legacy spectral character.

## Acceptance

1. At 48 kHz, 100% FM at C5 remains bit-identical between Legacy and HQ because the guard is inactive there.
2. At 48 kHz, 100% FM at C8, HQ depth is 0.37–0.38 (the former strict guard was 0.251), is finite, and the depth curve is monotonic non-increasing across MIDI 0–127.
3. At the C8 analysis case, HQ retains at least 15 dB less off-grid folded energy than Legacy; the acceptance metric records the actual difference rather than treating it as a listening-quality score.
4. Core parameter sweeps, deterministic/golden coverage, freestanding compilation, Web/WASM comparison, and disconnected high-FM safety coverage pass with no non-finite samples, residual note after release, or residual note after panic.
5. The final subjective check is a low-volume Legacy/HQ comparison using `?quality=1`; it is explicitly deferred while the owner is away from speakers.
