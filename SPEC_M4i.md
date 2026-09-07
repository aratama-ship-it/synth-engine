# SPEC M4i — Quality Lab separation

## Goal

Return the normal OSC surface to day-to-day sound design after the M4h auditions, while preserving the exact comparison tools for later verification.

## Scope

- Hide `QUALITY LAB` by default so OSCILLATOR A and B are the first modules on the normal OSC surface.
- Show the existing lab only when the URL contains `quality=1`.
- Preserve all four comparison buttons, their state text, `aria-pressed`, and current parameter updates.
- Keep the M4h compact density and 44 px interaction targets when the lab is visible.

## Non-goals

- No DSP, preset, parameter-default, audio-routing, or engine-version changes.
- No change to the audition decisions themselves: Balanced / Natural remains the preferred production direction, while Legacy remains the preferred current FM sound.
- No new permanent toolbar button for a developer-only comparison surface.

## Acceptance

1. The normal Studio URL does not expose `QUALITY LAB` in layout or the accessibility tree.
2. Adding `quality=1` restores both independent comparison groups and their existing behavior.
3. Core and web tests pass, and the normal OSC surface has no horizontal overflow at 1440×900 or 390×844.
4. The comparison URL retains 44 px targets and text-visible selected states.
