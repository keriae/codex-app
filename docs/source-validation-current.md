# Editable macOS source validation — 2026-10-26

The latest source/package results are recorded in [UI detail comparison — 2026-10-30](ui-detail-parity-2026-10-30.md): **187 files / 1,422 tests**, Node/Web typechecks, macOS arm64 packaging, deep strict codesign, configured fuses and **70/70** packaged output comparisons passed. The current dev renderer received bounded native command/copy, breadcrumb, responsive file-controls, full/split and 110% zoom acceptance, plus a completed native readonly model turn. The final production package's full native UI matrix was not rerun. Raw current checks are in `reverse/raw/ui-detail-2026-10-30/`, with [sanitized evidence](../reverse/ui-detail-evidence-2026-10-30.json).

The checks below describe the earlier 2026-10-26 snapshot, including its GUI acceptance, and do not apply automatically to a rebuilt package. The preceding [2026-10-29 UI detail](ui-detail-parity-2026-10-29.md) and [workbench/activity](workbench-activity-parity-2026-10-29.md) results retain their snapshot attribution.

That editable package used `release/mac-arm64/Codex.app`, bundle ID `com.openai.codex.replica`. Its implementation baseline directly inspected the captured **26.1016.62342 / 21477** artifacts through REA and the supplied recording. The installed application may update independently; the original installation and its native authorization checks remain unchanged.

## Final source and package checks

| Check | Result |
| --- | --- |
| Source suite | **182 files / 1,388 tests**, all passed |
| Node and Web TypeScript | Passed |
| macOS arm64 production packaging | Passed |
| `codesign --verify --deep --strict` | Passed |
| Configured Electron fuses, read back from package | Passed |
| Current build files identical to packaged ASAR files | **100 / 100** |
| Packaged renderer/backend startup | Ready, `app://-/index.html` |
| Inline-script CSP probe | Blocked |
| Geolocation permission | Denied |
| Renderer Node globals | Both unavailable |
| Uncaught renderer exceptions in runtime probe | **0** |

The release test report and source hashes are retained locally at `reverse/raw/checks/release-1.0.0/tests.json` and `report.json`; generated evidence remains Git-ignored. The package verifier checks the actual delivered bundle, including source hashes and every current `out/` file. These checks validate this source snapshot, rather than proving whole-application visual equivalence.

```sh
npm run typecheck
npm test -- --reporter=json --outputFile=reverse/raw/checks/release-1.0.0/tests.json
npm run package:mac
node scripts/reverse/verify-source-package.mjs release/mac-arm64/Codex.app reverse/raw/checks/release-1.0.0
node scripts/reverse/verify-runtime.mjs 9236
```

## Workspace and editor acceptance

The final package was launched against the installed Codex backend with the repository as its workspace. Native macOS input selected an existing project chat and interacted with the independent replica window. The chat remained under its existing writer; sending stayed disabled and no model turn was submitted.

`reverse/raw/checks/current/filesystem/` retains the fixture, native notification report, UI observations, final screenshot and baseline report. Acceptance covered:

- Native file atomic-replacement notifications, subscription-specific unwatch, out-of-root watch rejection, and actual Finder/Terminal/Cursor opener targets.
- Editable Markdown preview/source controls, native **⌘F**, line preview and Escape restoration, and selected text inserted into the composer without sending.
- The actual file-tree menu and macOS Save dialog. The earlier README snapshot exported exactly **8,701 bytes**, matching its source SHA-256 `f6a073b17ceb2e3dd484863b5fa868cc6ea98654ac3d310e9b759ffadbbf4d95`.
- Final rebuilt package notifications while the workspace was collapsed. Reopening displayed the changed clean file.
- Entering Settings unmounted the workspace surface. A fixture changed during that interval appeared with its latest disk text after returning to the chat; existing tabs and source mode remained intact.

The native subscription probe filters by its own ID, since open documents legitimately maintain separate subscriptions. Earlier editor acceptance under `current/editor/` exercised native **⌘S/⌘W**, autosave, disk conflicts, split/full views and unified titlebar bounds. This final pass added the folded/reentry cases; it did not repeat every earlier shortcut or crash the app to test restart recovery. macOS locked again during final UI cleanup, so the test process was stopped through its own terminal process. The fixture was restored to clean disk contents.

The **18 document-store tests** cover stale reads, startup draft recovery, changed file types, failed initial reads, pending-save undo/close, partial-write failure recovery and conflict persistence. **Five watch-subscription tests** cover delayed startup, baseline ordering, cancellation, startup failure and callback-error isolation. Real CodeMirror history tests cover undo/redo restoration; the native observations above do not establish every undo branch.

See [editor reconstruction](workspace-editor-parity.md) and [filesystem/file actions](workspace-filesystem-parity.md) for recovered source anchors and remaining implementation differences.

## External import acceptance

The installed CLI verification was repeated after the lifecycle fixes. It uses temporary isolated `HOME`, `CODEX_HOME`, XDG, project, source and replica-profile directories. It imported Claude Code instructions and three durable Cursor/Cowork fixture sessions, validated canonical project assignment, independent-session paths, plugin inventory, MCP configuration, skills/agents and generated files, then stopped its own server and removed the fixtures. No real user configuration/history was imported and no model turn was started.

`reverse/raw/checks/external-agent-import-current.json` records the result. The lifecycle suite has **24 backend tests**, and the four renderer import files have **28 tests**. They cover cancellation during preparation, disposition of already submitted work, active-waiter disposal, late completion after timeout, stopping before later writes, new-attempt status, trusted-result precedence and failed-only history. Application exit waits for import/local-write and terminal cleanup before stopping its server connection.

See [external import](external-agent-import.md) and [Settings parity](settings-parity.md) for format limits and the synthetic/native verification boundary.

## Remaining scope

Complete pixel and functional parity remains in progress in [the feature inventory](feature-inventory.md) and `reverse/obligations.json`. Editor gaps include the full Pierre decoration set, rich HTML/KaTeX Markdown and the original direct inline selection-edit review service. Additional Cowork formats, project/worktree operations and Settings surfaces still need recovery and acceptance.

The separate original-runtime reconstruction remains `release/local-runtime/Codex Study Final.app`, retaining **20,364 original renderer files** byte-for-byte. Its successful native model turn and the actual OpenAI signing-identity rejection of native app tools are recorded in [runtime reconstruction validation](reconstruction-validation-current.md). This source pass does not remove or bypass that authorization boundary.
