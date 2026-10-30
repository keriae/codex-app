# Demo and GitHub media

The demo is a recording of the editable client running with a fictional Orbit Notes workspace and deterministic responses from `scripts/reverse/promo-demo-server.mjs`. It demonstrates UI behavior; it is not a live model benchmark or a complete pixel-parity acceptance result.

| Asset | Purpose |
| --- | --- |
| [codex-app-preview.png](codex-app-preview.png) | Static README preview, 1600 × 900 |
| [github-social-preview.png](github-social-preview.png) | GitHub repository social preview, 1280 × 640 |
| [codex-replica-promo.mp4](codex-replica-promo.mp4) | 15-second walkthrough, 1920 × 1080 |
| [codex-replica-promo.gif](codex-replica-promo.gif) | Optional animated walkthrough, 1152 × 648; larger than the MP4 |
| [codex-replica-parity.png](codex-replica-parity.png) | Original demo capture used to derive the static previews |

The README image crops the committed demo capture to the application window: `(96, 54, 1824, 1026)`, then resizes it. This removes the surrounding promotional labels without changing the client UI. The social preview combines this same crop with project text; it does not invent additional UI.

To regenerate the two page images on macOS, use Python 3 with Pillow:

```bash
python3 promo/github-media.py
```

The script uses system Arial fonts and has no runtime dependency in the client. Capture and video reproduction instructions are in [promo/README.md](../../promo/README.md). The demo’s project, prompts, and responses are synthetic; no private projects, conversations, or credentials appear in these page assets.
