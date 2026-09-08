# M4t — Custom WT frame position

## Scope

Show the current `POS` location of a loaded Custom WT without changing audio, patch data, or import persistence.

## Contracts

- The indicator appears only when a Custom WT is loaded and OSC A or B selects `Custom · Session`.
- It has one row per oscillator. A non-Custom oscillator reads `OTHER WT`.
- For 1–4 loaded frames, `POS 0..1` maps continuously from frame 1 to the last frame.
- The visual marker, active ticks, and text describe the same location. A midpoint example is `F2 → F3 · 50%`; a single-frame table reads `F1 · FIXED`.
- This is display-only: it must not open the output gate, start/stop notes, alter a patch, write browser storage, or mutate the loaded WAV.
- CLEAR hides the indicator after the existing output-muted Custom WT cleanup succeeds.

## Verification

- Unit-test one-frame, midpoint, and clamped end-frame position mapping.
- Use isolated Chromium to load a four-frame WAV, select Custom on A/B, move POS, verify the visible labels, then CLEAR and verify the indicator is hidden.
- Re-run the disconnected-output Web Audio safety test and UI overflow/accessibility audit.
