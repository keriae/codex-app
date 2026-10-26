# REA reverse engineering and reconstruction

The project follows [REA](https://github.com/morluto/rea) to inspect the installed macOS application's shipped JavaScript, CSS, ASAR, native runtime and assets directly. The editable client uses those source facts and the supplied recording to implement matching behavior against the real Codex app-server. The local reconstruction retains the original implementation. These are separate paths and have separate acceptance criteria.

## Targets and provenance

Captured source baseline: `/Applications/ChatGPT.app`, `com.openai.codex`, **26.1016.62342 / 21477**, with companion CLI **0.163.0-alpha.11.2**. The historical geometry/protocol baseline is **26.1016.61520 / 21421**; do not assign its hashes, offsets or observations to another version. The installed application may update independently, so refresh evidence before attributing these hashes or observations to a newer build.

- [Source provenance](../reverse/source-provenance.json) records current inspected module digests and bounded source checkpoints.
- [Evidence index](../reverse/evidence-index.json) maps high-value features to target versions, REA evidence IDs, implementation files, validation records and explicit unknowns.
- [Visual baseline](visual-baseline.md), [`reverse/baseline/26.1016.61520.json`](../reverse/baseline/26.1016.61520.json) and the [recording index](../reverse/video-evidence-2026-10-23.json) preserve comparison contracts.
- [Feature inventory](feature-inventory.md) and [obligations](../reverse/obligations.json) record implementation scope and remaining work.

Inspect static shipped resources as data. Computer Use denied the original `com.openai.codex` surface; comparison therefore uses static resources and the user's recording. Do not use another control channel to bypass that denial. The editable replica can be used for live verification.

The REA methods used are its [artifact reconstruction guide](https://github.com/morluto/rea/blob/3e7e102a518b9112a2a8aa0590ae6f6951fd0635/docs/javascript-artifact-reconstruction.md) and [application workflows](https://github.com/morluto/rea/blob/3e7e102a518b9112a2a8aa0590ae6f6951fd0635/docs/javascript-application-workflows.md). A compatible pinned invocation is:

```bash
npx --yes --package node@24.11.0 --package rea-agents@6.7.0 rea --help
```

A focused REA entry/preload pass inspected `package.json`, `.vite/build/early-bootstrap.js` and `.vite/build/preload.js`. Its evidence ID is `ev_d702624abc628a62a2d1d89bf7f7ec91cac9c4d96727b324ec1e3018554454cb`; artifact SHA-256 is `5b5cf52887cfd4de19cb5862155a8ef6cf58830c0a2fc592b72060cfcc3be869`. Selected-source analysis establishes that boundary, not complete semantic recovery of the full renderer. Native signing can leave installed unpacked-file digests inconsistent with ASAR declarations; retain and inspect those contradictions rather than assuming original integrity metadata is exhaustive.

## Local reconstruction

[`reconstruct-local.mjs`](../scripts/reverse/reconstruct-local.mjs) copies the installed Electron/Owl framework, main process, preload, renderer, native modules and relative resources. The original renderer's host services use a transferable `MessagePort` and a broad host RPC surface. Retaining the whole runtime preserves those interfaces and the native ABI together.

The reconstruction reads the live package and Info.plist. Exact patch anchors must occur once; an upstream structural change fails the build and requires a fresh audit. It alters only these original ASAR infrastructure files:

| File | Purpose |
| --- | --- |
| `.vite/build/early-bootstrap.js` | Apply isolated desktop profile and existing-server routing before/after shell environment loading. |
| `.vite/build/file-based-logger-DD0smlUs.js` | Keep custom file logs beneath the independent profile. |
| `.vite/build/bootstrap-DCRTDDSX.js` | Leave the installed application's OS URL handler registered. |

The renderer and business RPC implementation remain unchanged. Native code signatures change during local signing. No authentication, DeviceCheck or license implementation is patched.

`CODEX_ELECTRON_USER_DATA_PATH` and isolated desktop `CODEX_HOME` keep settings, logs and SQLite separate. `owl-app.ini` uses `UserDataDirectoryName=Codex Replica Local` because Owl initializes native/browser storage before JavaScript. Its root is `~/Library/Application Support/Codex Replica Local`; custom desktop `--profile` uses an additional root. Canonical-path and symlink checks reject aliases of the original application/profile, output application or server home.

A CLI wrapper restores the existing server's `CODEX_HOME` and forwards arguments unchanged. Existing authentication, provider settings, plugins and threads remain server data. Credentials, cookies, tokens, databases and the original browser profile are not copied into the reconstruction. `CODEX_SPARKLE_ENABLED=false` disables replacement by the production updater, and the copy uses `com.openai.codex.replica.local`.

## Integrity and signing

The installed framework preserves nine fuse wires; the reconstruction reads and retains all of them, including enabled embedded-ASAR integrity and ASAR-only loading. Native components and nested bundles are signed leaves first with a local ad-hoc identity. Their resulting bytes are included in the repacked ASAR integrity declarations before the outer bundle is signed.

Info.plist's `ElectronAsarIntegrity` is the SHA-256 of the ASAR header JSON string, not the whole archive. Owl also seals the integrity dictionary in `__DATA_CONST,__asar_integrity`. The builder updates that digest through the package-time algorithm, leaving the slot enabled/version fields and all validation fuses unchanged. It checks the sealed digest again after signing.

Each build creates sibling `.reconstruction` manifests with resource/ASAR digests. Verification covers every ASAR entry, original/output fuse equality, unexpected resource changes, unchanged renderer digests, `codesign --verify --deep --strict`, and a final rehash of the installed source. The audited target retained **20,364 renderer files byte-for-byte**. The historical retained report covered **21 profile-path guard cases**; the current delivered-bootstrap verifier covers **37 cases**. These static checks and a backend startup smoke do not establish full interaction or pixel parity.

Local ad-hoc signing omits the production hardened-runtime flag and cannot reproduce OpenAI's signing identity, DeviceCheck, APNs or shared Keychain access. The preserved authorization checks still apply.

## Editable source verification

The editable package is produced by `npm run package:mac`. It uses a restricted `app://-/index.html` renderer origin, independent desktop data and `com.openai.codex.replica`. Its eight configured Electron fuse values are recorded in the historical baseline. Read them back from each new package; configuration alone is not evidence. Reapply local signing after fuse mutation and verify the exact resulting bundle.

The package verifier compares current `src`, package configuration, `out` and the matching test report. Rechecking another package requires its matching snapshot. Generate reports beneath ignored `reverse/raw/checks/`; do not overwrite or reuse a report to claim a different source snapshot passed.

Use the [README commands](../README.md#build-and-verify) for typechecks, tests, builds and package checks. Runtime verification should then use that exact editable bundle. Geometry/style snapshots can use `scripts/reverse/cdp-layout-snapshot.mjs` on the replica's own CDP endpoint, with matching viewport, DPR, state and theme.

Current incremental source evidence includes three previously open areas. Thread Goals use the inspected 0.163 `thread/goal/set`, `thread/goal/get`, `thread/goal/clear`, updated and cleared contracts, with bounded renderer RPC schemas, selection hydration, response/notification ordering guards, pause/resume/edit/replace/clear controls, interrupt-to-pause behavior and a completion marker retained after automatic clear. “Open in new window” creates a separate cascaded `BrowserWindow`; its validated route queue is scoped to that managed window, rejects untrusted senders and malformed identifiers, and replays across renderer readiness or reload only until acknowledgment. A working-tree worktree start snapshots `HEAD` with a binary Git patch plus non-ignored untracked paths, applies it in the private detached checkout without mutating the source, and the new-worktree fork path creates that checkout before issuing `thread/fork` with the source model, reasoning effort and resolved configuration. These implementations remain subject to native interaction and pixel acceptance, cross-window local-state synchronization, and the remaining worktree ownership/archive/restore/handoff lifecycle.

For each feature, inspect its source and recorded behavior, implement it, verify meaningful model/transport interactions, then compare actual rendering. Update an obligation to complete only when both behavior and visual acceptance pass. Raw extracts, captures, logs, profiles and generated bundles are disposable ignored outputs; retain the supplied MP4/screenshots, code, meaningful tests and runtime assets.
