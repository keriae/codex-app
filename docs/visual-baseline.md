# Codex macOS visual baseline

This document records a sanitized, read-only layout sample of the upstream
macOS Codex workspace. It makes comparisons repeatable for the historical 21421 shell state. Current 21477 source and asset inspection is recorded separately in [source provenance](../reverse/source-provenance.json).

## Evidence boundary

- Target: `com.openai.codex`, version `26.1016.61520` (build `21421`).
- Reference image: `4112 x 2406` physical pixels, corresponding to a
  `2056 x 1203` CSS-pixel viewport at device pixel ratio 2.
- Renderer verification uses only `getBoundingClientRect()`, selected
  `getComputedStyle()` properties, and viewport metrics through an isolated
  CDP endpoint.
- No DOM text, accessible names, account data, thread contents, cookies,
  storage, network payloads, or icon assets are retained in the baseline.

The user-supplied interaction recording is indexed by
`reverse/video-evidence-2026-10-23.json`. Its original MP4 stays locally under ignored `reverse/raw/video/`; reference screenshots stay in `reverse/raw/reference/`. Extracted frames and contact sheets are intermediate output. The recording is the
behavioral authority for menus, workspace tabs, loading and streaming states,
full-page routes, and diagram previews; stable shell geometry remains governed
by `reverse/baseline/26.1016.61520.json`.

All dimensions below are CSS pixels. Half-pixel positions are intentional and
produce one-device-pixel rules at DPR 2.

## Reference frame

At the standard viewport, the application reserves 44 px for the unified
titlebar. The workspace is inset 4 px from the window's right and bottom
edges, leaving a `2052 x 1155` content frame.

| Region | Reference rectangle | Stable behavior |
| --- | --- | --- |
| Titlebar | `0, 0, 2056, 44` | Unified draggable titlebar |
| Workspace | `0, 44, 2052, 1155` | 4 px right and bottom window inset |
| Icon rail | `0, 44, 52, 1155` | Fixed-width navigation column |
| Sidebar | `52, 44, 468, 1155` | Fixed reference width in the captured state |
| Main | `520, 44, 1532, 1155` | Extends to the workspace frame edges |
| Empty conversation track | `520, 44, 1532, 1155` | No output lane is reserved on a new chat |
| Thread conversation track | `520, 44, 1227, 1155` | Main minus the fixed output track |
| Thread output track | `1747, 44, 305, 1155` | Present only when a thread has content |
| Thread output card | `1747, 52, 300, 78` | 5 px right inset, 8 px top inset, 18 px radius |

The root content row is `calc(100vh - 44px - 4px)` high. The main region is
`calc(100vw - 520px - 4px)` wide in this saved sidebar state.

## Reusable design tokens

```css
:root {
  --codex-window-bg: rgb(29 29 29);                       /* #1d1d1d */
  --codex-chrome-bg: rgb(29 29 29);                       /* #1d1d1d */
  --codex-rail-bg: rgb(29 29 29);                         /* #1d1d1d */
  --codex-main-bg: rgb(17 17 17);                         /* #111111 */
  --codex-sidebar-bg: rgb(21 21 21);                      /* #151515 */
  --codex-composer-bg: rgb(47 47 47);                     /* #2f2f2f */
  --codex-output-card-bg: rgb(38 38 38);                  /* #262626 */

  --codex-fg: rgb(252 252 252);                           /* #fcfcfc */
  --codex-fg-85: oklab(0.991063 0.0000452101 0.0000197887 / 85%);
  --codex-fg-60: oklab(0.991063 0.0000452101 0.0000197887 / 59.5%);
  --codex-fg-muted: rgb(252 252 252 / 49.8%);
  --codex-selected-bg: rgb(39 39 39);                     /* #272727 */
  --codex-divider: rgb(252 252 252 / 15.7%);

  --codex-radius-sm: 9.375px;
  --codex-radius-md: 10px;
  --codex-radius-frame: 12px;
  --codex-radius-control: 12.5px;
  --codex-radius-composer: 22px;
  --codex-radius-pill: 9999px;

  --codex-font-system: -apple-system, system-ui, "Segoe UI", sans-serif;
  --codex-font-display: "OpenAI Sans", -apple-system, system-ui, "Segoe UI", sans-serif;
}
```

Observed contextual accents include `#40c977`, `#0169cc`, `#12bde8`,
`#b390ff`, `#b06dff`, and `#ff8549`. Their semantic assignment depends on the
view state and should not be inferred from this single capture.

## Typography

The application primarily uses the macOS system stack. A computed weight of
430 is common and should not be rounded to 400 if the renderer supports variable
font weights.

| Use | Family | Size / line height | Weight |
| --- | --- | --- | --- |
| Root/default | System | `16 / 24` | 430 |
| Sidebar row | System | `13 / 18.5714` | 430 |
| Compact control | System | `13 / 18` | 430 |
| Micro icon metadata | System | `12 / 12` | 400 |
| Composer editor | System | `14 / 20` | 430 |
| Section heading | OpenAI Sans fallback stack | `18 / 24` | 600 |
| Large neutral-state heading | System | `28 / 33.6` | 400 |

No non-default letter spacing was observed in the sampled state.

## Titlebar and rail

The titlebar is a fixed 44 px-high drag region with `user-select: none`.
Interactive children opt out with `-webkit-app-region: no-drag`.

- The historical image has traffic lights near `x = 10`, `y = 8`. Current native source places them at `x = 16`, `y = round((44 × zoom − 14) / 2)`; the editable window follows that source. DOM navigation controls occupy 28 x 28 hit boxes inside the remaining titlebar.
- The titlebar's left grid column matches the full 520 px rail-plus-sidebar
  width so the thread title begins exactly over the main region.
- A new, empty chat leaves the center title area blank and exposes only the
  28 px new-chat control at the right. Conversation and workspace controls are
  not rendered until a thread exists.
- The rail is 52 px wide and uses 36 x 36 controls.
- Rail controls are 36 x 36 with a 12.5 px radius. The selected control uses
  full `#fcfcfc`; inactive controls use the 49.8% muted foreground.

## Sidebar

The reference frame uses a 468 px sidebar. This is the width to use for exact
pixel comparison at the standard viewport; it is not evidence of a factory
default for a fresh profile.

- Header band: 90 px high. Its first row is 52 px high.
- Scroll region starts below the header at `y = 134` and extends to the
  workspace frame's bottom edge.
- Standard list row: 452 x 30 inside an 8 px horizontal inset, 12.5 px radius,
  `padding: 5px 5px 5px 8px`, and 13 px type.
- Selected-row fill: `#272727` over the `#151515` sidebar.
- Common trailing icon hit area: 20 x 20, fully rounded.

Thread-dependent row counts and all row labels were deliberately excluded.

## Main region

The main region uses `background: #111` and `overflow: hidden`. There is no
second content-area header: the conversation begins directly below the 44 px
titlebar.

- A blank new chat uses the full 1532 px main width and does not render or
  reserve the 305 px output track.
- Once a thread has content, the main splits into a 1227 px conversation track
  and a fixed 305 px output track. Its conversation container is 768 px wide at
  `x = 749.5`; 16 px horizontal padding leaves 736 px beginning at `x = 765.5`.
- The thread output card is 300 x 78 at `x = 1747`, `y = 52`, with an 18 px
  radius and `#262626` fill.
- Scrollable conversation content extends underneath the fixed composer and
  provides enough bottom padding to keep the final turn readable.

## Composer

At the standard viewport, the blank-new-chat state is:

| Layer | Rectangle | Notes |
| --- | --- | --- |
| Centering container | `902, 1047, 768, 136` | Full empty-state stack, centered in the main |
| Context rail | `931, 1047, 710, 42` | 20 px top radius, overlaps composer by 4 px |
| Visible surface | `918, 1085, 736, 98` | `#2f2f2f`, 22 px radius |
| Editor | `930, 1099, 712, 44` | 14 / 20 type, weight 430 |

The visible surface is always 16 px narrower on each side than the centering
container. On an empty chat its bottom edge stays 16 px above the workspace
bottom; a content-bearing thread retains the measured 12 px inset.

The sampled internal grid has 48 px and 28 px rows with a 5 px column gap. The
first row contains the editor; the second contains left and right tool groups.
Icon controls are 28 x 28 pills. Text controls are 28 px high with 6-8 px inline
padding. The primary circular action is 28 x 28 with a `#fcfcfc` fill.

The editor's scroll wrapper uses a 25vh cap. Composer height above 98 px is
content-dependent and must be tested separately from the neutral baseline.

## Responsive behavior

This baseline intentionally covers only the `2056 x 1203` expanded-sidebar
state. Narrow-window output-panel visibility, sidebar collapse behavior,
minimum native window size, and restoration of a saved sidebar width require a
separate real-window capture before they become conformance requirements.

## Comparison checklist

For deterministic visual tests:

1. Use the same application version, dark theme, viewport, DPR, sidebar state,
   and saved sidebar width.
2. Assert the exact `2056 x 1203` viewport and expanded-sidebar geometry before
   comparing pixels.
3. Compare CSS-pixel geometry before raster output; several dividers rely on
   half-pixel placement at DPR 2.
4. Assert that empty chat has no output track/card and that its 736 px composer
   is centered in the full main region with a 16 px bottom inset. Assert the
   305 px output track and 12 px composer inset separately on content threads.
5. Do not use thread counts, labels, account-dependent headings, or icon artwork
   as baseline data unless a separate sanitized fixture supplies them.

## Known limitations

- Only one dark-theme, expanded-sidebar thread state was used for this exact
  geometry baseline.
- Hover, focus, pressed, drag, menu, approval, error, streaming, and light-theme
  states were not exercised.
- Icon geometry and artwork were not extracted.
- The sidebar width is persisted user state and may differ on a fresh profile.
- Responsive and native minimum-window behavior are not encoded in this
  baseline.
- Every comparison must re-check viewport, DPR, and expanded/collapsed state
  before taking measurements.
