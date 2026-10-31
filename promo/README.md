# Client walkthrough

The GitHub demo is a **35-second, 1920 × 1200, 30 fps** Remotion composition. It opens on the real reconstructed client, then shows conversation activity, file review, full/split views, diff options, Markdown editing and preview, and retained workbench tabs. Its source is a passive native window capture of a fictional Orbit Notes project, operated through the actual UI.

Responses come from the deterministic demo server. Sections are cut and accelerated, with their playback rate shown in the video. This demonstrates UI behavior, not live model speed or complete application parity.

## Render the committed clips

```bash
cd promo
npm ci
npm run render
```

The output in `docs/media/` includes the H.264 video, a 960 × 600 animated GIF, a closing card, and a client still. The GIF is approximately 1.2 MB; the MP4 is under 1 MB. `npm run studio` opens the editable composition.

From the repository root, run `python3 promo/github-media.py` with Pillow to regenerate the README still and sharing cover. See [media notes](../docs/media/README.md) for dimensions, cropping and provenance.

## Record new footage

Keep capture data separate from personal projects and chats:

1. Copy `demo-workspace/` to `/tmp/orbit-notes-demo`.
2. Start the fixture with its own Codex home:

   ```bash
   node scripts/reverse/promo-demo-server.mjs \
     --workspace /tmp/orbit-notes-demo \
     --codex-home /tmp/codex-promo-home --port 9387
   ```

3. Launch the built replica with its own profile:

   ```bash
   CODEX_HOME=/tmp/codex-promo-home \
   CODEX_REPLICA_USER_DATA_PATH=/tmp/codex-promo-profile \
   CODEX_APP_SERVER_URL=ws://127.0.0.1:9387 \
   release/mac-arm64/Codex.app/Contents/MacOS/Codex \
     --cwd=/tmp/orbit-notes-demo --remote-debugging-port=9237
   ```

4. Select the fictional chat. Find the replica's native window ID, then use the passive helper:

   ```bash
   node scripts/reverse/record-promo-demo.mjs \
     --workspace /tmp/orbit-notes-demo --window-id <window-id> \
     --port 9237 --seconds 60
   ```

The helper observes the selected workspace and visible text before and after capture. It records only the validated replica window and writes below ignored `reverse/raw/`. It performs no clicks, typing, scrolling, focusing, reloading or resizing. Operate the app manually or through native Computer Use while recording. Do not use the original installed app or real account history as public demo data.

Raw MOV containers can contain a local author field. Remove all container metadata with `-map_metadata -1` during H.264 transcoding, omit audio, and review both metadata and the whole video before moving clips into `public/`. A preflight text check cannot replace inspection of the finished footage.

The current source clips are `codex-replica-live.mp4` (conversation), `codex-replica-workbench.mp4` (review), and `codex-replica-edit.mp4` (editor and tabs). Their native window and shadow bounds are documented in the composition. Trim offsets, playback rates and scene labels remain editable there. If a new capture uses different window dimensions or shadow margins, update the crop constants before rendering.
