# SPEC M4n — Shared insert FX core

## Goal

Move the four reorderable insert effects from a Web-only AudioNode graph into the shared DSP core so Web, AU, and the standalone host expose the same insert processing and saved parameter state.

## Scope

- Share `Distortion / Chorus / 3-band EQ / Compressor` and their four-slot order.
- Append parameter IDs 90–112. Do not renumber IDs 0–89.
- Keep Delay and Reverb in the Web shell. They remain a lightweight parallel time-effects stage after the shared inserts.
- Preserve the existing patch schema. Its `fx` object remains the human-readable canonical Web representation and is mapped to the appended core parameters when loaded.

## Parameter contract

| ID | Parameter | Range | Default |
|---:|---|---:|---:|
| 90 | Distortion On | 0–1 integer | 0 |
| 91 | Distortion Drive | 0–1 | 0.28 |
| 92 | Distortion Tone | 800–18,000 Hz | 12,000 |
| 93 | Distortion Mix | 0–1 | 0.48 |
| 94 | Chorus On | 0–1 integer | 0 |
| 95 | Chorus Rate | 0.05–5 Hz | 0.32 |
| 96 | Chorus Depth | 0–1 | 0.45 |
| 97 | Chorus Width | 0–1 | 0.8 |
| 98 | Chorus Mix | 0–0.65 | 0.32 |
| 99 | EQ On | 0–1 integer | 0 |
| 100–102 | EQ Low / Mid / High | −18–18 dB | 0 |
| 103 | Compressor On | 0–1 integer | 0 |
| 104 | Compressor Threshold | −60–0 dB | −18 |
| 105 | Compressor Ratio | 1–20 | 3 |
| 106 | Compressor Attack | 0.001–0.2 s | 0.012 |
| 107 | Compressor Release | 0.03–1 s | 0.22 |
| 108 | Compressor Makeup | 0–12 dB | 1 |
| 109–112 | Insert Order 1–4 | 0–3 integer | 0, 1, 2, 3 |

Order values use `0 = Distortion`, `1 = Chorus`, `2 = EQ`, `3 = Compressor`. An invalid or duplicate permutation falls back to the default order for that sample instead of producing undefined routing.

## DSP contract

- Each module has click-resistant wet/bypass smoothing. Default bypass must remain bit-identical with the previous core.
- Distortion is normalized soft saturation followed by a tone low-pass.
- Chorus is a stereo modulated-delay with bounded interpolation and no dynamic allocation.
- EQ is a stable three-band split with independent dB gains.
- Compressor is stereo-linked and uses attack/release envelope tracking plus makeup gain.
- `SYNTH_RESET_VOICES` and `SYNTH_RESET_ALL` clear all insert histories. Parameters are retained for VOICES reset and returned to defaults for ALL reset.
- The 20-byte event ABI and C entry points remain unchanged. Engine version becomes 15 and parameter count becomes 113.

## Web integration

- The existing insert UI and schema-version-1 patch shape stay unchanged.
- UI changes send the mapped core parameters to the SynthNode. The Web shell no longer creates a duplicate WebAudio insert rack.
- Shared core output connects directly to the safety gate and to the existing Delay/Reverb stage.

## Acceptance

1. Metadata is contiguous through ID 112 and AU dynamic metadata exposes all 113 parameters.
2. Old presets and default-bypass renders remain bit-identical.
3. Every insert produces finite output and an objective signal change when enabled.
4. Reordering active inserts changes output deterministically; invalid order remains finite and deterministic.
5. Reset clears effect history, and rendering remains block invariant.
6. Native/WASM preset renders match within the established sample-level contract.
7. Web tests prove patch-to-core mapping and prove the duplicate WebAudio rack is no longer instantiated.

## Deferred listening gate

The move establishes shared behavior, not a claim of perceptual identity with the former WebAudio implementations. Final drive character, chorus depth, EQ turnover frequencies, and compressor feel remain a human listening check.
