# Editable macOS source validation

The [publication validation](github-publication-validation-2026-10-31.md) records the latest source tests, types and public media review after anonymizing test fixtures and evidence metadata. Native package and frozen-source hashes below retain their original snapshot attribution; changing the two test fixtures does not revalidate those hashes.

The 210-file/1,663-test/71-output [UI element comparison](ui-element-parity-2026-10-31.md) records the per-control shell, conversation and workbench changes, original resource version attribution and independent source/package/native validation. Its [sanitized evidence index](../reverse/ui-element-evidence-2026-10-31.json) is authoritative for that snapshot. The 192/1,478/70 results below belong to the preceding detail checkpoint and cannot validate those element changes.

The preceding delivered detail snapshot, recorded in [UI detail comparison — 2026-10-31](ui-detail-parity-2026-10-31.md), adds expanded-row ancestor guides, compact-command → detailed-row → raw-output disclosure, and persistent ancestor-resize selection reveal with logical zoom geometry and user-scroll cancellation. Its `acceptance-final/tests.json` has **192 files / 1,478 passed tests**; Node/Web typechecks passed. Final package report passed deep strict codesign, configured fuses, **70/70** packaged build comparisons and matching audited source hashes; bounded native supplementary acceptance passed compact→detailed→output clicks, elapsed values 27→40→41s, fixture-link ancestor reveal, and main/breadcrumb guide hover/collapse/reopen. Official CLI **0.164.0** / `gpt-6.1-sol` completed 80 output lines / 44,977ms / exit 0 and a fixture-only 1→2 file change. Changed-tree +1/−1/M, diff view and hover guides passed; native sidebar user scroll remained at 200. The fixture thread/subscription, temporary file, native package and isolated listener were cleaned up; original server remains running. Final source/ASAR recheck passed. Full long-sidebar/MCP/theme/window matrices remain incomplete. The **190/1,462/70** results below remain a preceding checkpoint and cannot validate those later changes. Native application-menu Quit exited the old package successfully; CUA inspection subsequently auto-launched a new default-profile process, which also exited through native Quit. Both PIDs were checked absent without requesting UI state again.

The preceding same-day **190-file / 1,462-test** checkpoint (`acceptance/`) is recorded in [UI detail comparison — 2026-10-31](ui-detail-parity-2026-10-31.md), with [sanitized evidence](../reverse/ui-detail-evidence-2026-10-31.json). It directly inspects installed **26.1027.30824 / 22943** resources and improves file navigation, process output, composer text and scroll behavior. **190 files / 1,462 tests**, Node/Web typechecks and macOS arm64 packaging passed; deep strict codesign, configured fuses and **70/70** matching packaged output comparisons passed. The production `app://-/index.html` renderer was ready with `require` and `process` unavailable. Native package checks passed tab menus, Escape/Shift+F10, middle-click closing, 100%/110% menu positioning, exact 110% composer paste/logical height, nested reversed-output scrolling without moving the main conversation, and tree focus retention through watcher refresh and directory collapse. Official CLI **0.164.0**, `gpt-6.1-sol` completed the dev 40-line fixture and production 80-line/19,951ms and sleep-35/34,908ms turns, all exit 0. The two fixture threads, notification subscription and this task's independent listener were cleaned up; original chats and server were retained. Noncompact detailed-command per-second timing in the current normal command path has model coverage but was not observed natively; background-terminal state and timing gates are not yet integrated or verified; compact active summaries retain the original action-only presentation. Complete pixel/function parity and MCP media, long-history and full light/dark/window matrices remain incomplete. Later source changes require a new matching snapshot verification.

The preceding [UI detail comparison — 2026-10-30](ui-detail-parity-2026-10-30.md) snapshot passed **187 files / 1,422 tests**, Node/Web typechecks, macOS arm64 packaging, deep strict codesign, configured fuses and **70/70** packaged output comparisons. Its dev renderer received bounded native command/copy, breadcrumb, responsive file-controls, full/split and 110% zoom acceptance, plus a completed native readonly model turn. That production package's full native UI matrix was not rerun. Its raw checks remain in `reverse/raw/ui-detail-2026-10-30/`, with [sanitized historical evidence](../reverse/ui-detail-evidence-2026-10-30.json).

The checks below describe the historical 2026-10-26 snapshot, including its GUI acceptance, and do not apply automatically to a rebuilt package. The [2026-10-29 UI detail](ui-detail-parity-2026-10-29.md) and [workbench/activity](workbench-activity-parity-2026-10-29.md) results retain their snapshot attribution.

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
