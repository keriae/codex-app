# Promo video

The repository's launch video is a 15-second, 1920×1080, 30 fps Remotion composition that opens directly on a capture of the running macOS `codex-app` client reconstruction. Its workflow rail presents INPUT, INSPECT, EDIT, VERIFY, MATCHED before the final title card. The conversation and workspace are deterministic fixtures; this is a UI walkthrough, not a live model benchmark or a pixel-parity acceptance result. No private threads, projects, or credentials are included in the footage.

## Render the finished assets

```bash
cd promo
npm ci
npm run render
```

Outputs are written to `docs/media/`:

- `codex-replica-promo.mp4` - full H.264 video
- `codex-replica-promo.gif` - optional animated preview; larger than the MP4
- `codex-replica-poster.png` - original title-card cover
- `codex-replica-parity.png` - deterministic client demo frame

Use `npm run studio` to preview or edit the composition.

## Refresh the GitHub page images

From the repository root, run `python3 promo/github-media.py` with Python 3 and Pillow on macOS. It crops the application window from the committed demo frame to create `codex-app-preview.png` and a 1280×640 `github-social-preview.png`. See [media notes](../docs/media/README.md) for provenance and dimensions.

## Refresh the live App capture

The recording helper drives the real Electron client through CDP and refuses to continue if the visible UI contains a username, home-directory path, private IP address, or email address. Keep the demo workspace under a username-free path such as `/tmp/orbit-notes-demo` so file and diff views remain safe to publish.

1. Copy `demo-workspace/` to `/tmp/orbit-notes-demo`.
2. Start `scripts/reverse/promo-demo-server.mjs` with that workspace and an isolated `CODEX_HOME`.
3. Launch the reconstructed client against the fixture with an isolated `CODEX_REPLICA_USER_DATA_PATH` and CDP enabled.
4. Run `scripts/reverse/record-promo-demo.mjs` to create `public/codex-replica-live.mp4`.

The recording script exercises the actual app flow: type a prompt into the real composer, send it, display the running command and file-change states, and return to the completed response. Re-render the Remotion composition after replacing the capture.
