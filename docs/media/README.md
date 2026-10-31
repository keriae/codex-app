# Demo and GitHub media

The 35-second walkthrough records the running macOS client with a fictional **Orbit Notes** workspace and deterministic responses from `scripts/reverse/promo-demo-server.mjs`. It shows real UI interactions: submitting a prompt, following activity, opening the workbench, reviewing full-file and word differences, editing Markdown, previewing it, and retaining tabs.

The recording is cut and accelerated for length. Each section displays its playback rate. It is a UI walkthrough, not a live model benchmark or a complete parity acceptance result.

| Asset | Purpose |
| --- | --- |
| [codex-replica-promo.gif](codex-replica-promo.gif) | Inline README demo, 960 × 600, about 1.2 MB |
| [codex-replica-promo.mp4](codex-replica-promo.mp4) | Full walkthrough, 1920 × 1200, 30 fps, under 1 MB |
| [codex-app-preview.png](codex-app-preview.png) | Actual client still, 1600 × 1014 |
| [github-social-preview.png](github-social-preview.png) | Repository sharing cover, 1280 × 640 |
| [codex-replica-parity.png](codex-replica-parity.png) | Demo frame used to derive the static previews; its name is not a parity certification |
| [codex-replica-poster.png](codex-replica-poster.png) | Video closing card |

The three source clips in `promo/public/` contain only the fictional demo. Raw macOS MOV recordings stay local: their author metadata is removed when creating the committed H.264 clips. No audio is recorded. The raw reference application recording and extracted application bundles are excluded from public media.

The native recorder adds asymmetric shadow margins. The 1532 × 1012 source has a 1420 × 900 application window at `(56, 38)`. The composition crops those margins without altering the client UI, and adds labels outside the window. The still-image generator crops `(96, 66, 1824, 1161)` from the finished demo frame, then resizes the window. The sharing cover combines that same window with project text.

Regenerate the static page images on macOS with Python 3 and Pillow:

```bash
python3 promo/github-media.py
```

The script uses system Arial fonts. See [capture and rendering instructions](../../promo/README.md) and [publication validation](../github-publication-validation-2026-10-31.md) for provenance and verification scope.
