# SPEC M4aw — Musical three-band EQ

## Goal

Raise the sound quality and live-edit safety of the existing shared three-band EQ before expanding external preset conversion. Keep the current `LOW / MID / HIGH` controls and patch schema so Web, AUv3, and standalone hosts receive the same DSP behavior without a new UI decision.

## Scope

- Replace the former first-order band split with three cascaded, double-state biquads.
- Keep parameter IDs 99–102, their ranges, defaults, and insert-order behavior unchanged.
- Keep fixed musical centers for this bounded pass:
  - LOW: 160 Hz low shelf, slope 1.
  - MID: 1.2 kHz bell, Q 0.75.
  - HIGH: 6.8 kHz high shelf, slope 1.
- Smooth LOW / MID / HIGH gain changes with the existing 5 ms control time constant while a voice is active.
- Snap gains before the first note and after reset, so preset loading does not sweep from stale values.
- Clamp fixed centers below 45% of the current sample rate.

## Compatibility and safety

- EQ BYPASS and EQ ON with all three gains at 0 dB must preserve the previous dry PCM bit-for-bit.
- Reset clears all six stereo biquad histories and restores the retained or default gain targets according to reset kind.
- No heap allocation, exceptions, RTTI, or host-specific DSP are added.
- The 20-byte event ABI, parameter count 121, and patch schema 1 remain unchanged.
- Because enabled-EQ PCM changes intentionally, engine version becomes 29.

## Acceptance

1. A +12 dB LOW setting gives at least +9 dB near 65 Hz and no more than +1 dB near 1 kHz.
2. A +12 dB MID setting gives at least +9 dB near 1 kHz and no more than +1 dB near 65 Hz or 8.4 kHz.
3. A +12 dB HIGH setting gives at least +7 dB near 8.4 kHz and no more than +1 dB near 1 kHz.
4. An active-voice gain change begins with the 5 ms smoother rather than jumping to the target in one sample.
5. Repeated full-range gain changes remain finite and bounded; note release and panic leave no audible residual.
6. Core tests, freestanding compile, WASM build, Web tests, and Apple compile-only all pass.

## Deferred listening gate

Automation and response tests establish safety and intent, not final musical preference. The owner should compare LOW, MID, and HIGH at low speaker volume. Adjustable frequency/Q, a response graph, and additional EQ types are separate UI/schema decisions and are not included in M4aw.
