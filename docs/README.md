# Documentation

Start with the [English quick start](../README.md#quick-start) or [中文快速开始](../README.zh-CN.md#快速开始). This index separates the editable client’s implementation and validation from the local retained-runtime study build.

## Build and verify the editable client

```bash
npm run typecheck
npm test
npm run build
npm run package:mac
```

| Guide | Use it for |
| --- | --- |
| [Source and package validation](source-validation-current.md) | Editable-client test, native runtime, packaging, and security checks |
| [Feature inventory](feature-inventory.md) | Implemented surfaces, known gaps, and validation boundaries |
| [Contributor guide](../CONTRIBUTING.md) | Development setup, focused changes, and public-source requirements |

Optional packaged runtime and layout checks:

```bash
release/mac-arm64/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9225
npm run runtime:check -- 9225
npm run visual:check -- 9225
```

The runtime launch stays in the foreground; run the two check commands in another terminal. These checks exercise documented contracts and layouts; they do not establish whole-app pixel equivalence.

## Conversations and app-server

| Guide | Topic |
| --- | --- |
| [App-server protocol](app-server-protocol.md) | Initialization, transport, requests, notifications, and endpoint configuration |
| [Transport recovery](transport-recovery.md) | Reconnection, request delivery, and mutation recovery boundaries |
| [Conversation activity](activity-parity.md) | Streaming process rows, grouping, tool output, and timing |
| [Conversation detail snapshot — Oct 31](conversation-detail-parity-2026-10-31.md) | Live command timing, reversible disclosure, and annotated MCP media/output |
| [Thread operations](thread-operations.md) | Resume, fork, compact, archive, and thread lifecycle |
| [Writer conflicts](thread-writer-conflicts.md) | Cross-client thread ownership and safe resume behavior |
| [External agent import](external-agent-import.md) | Local Claude Code, Cursor, and Cowork session import |

## Workspace and desktop

| Guide | Topic |
| --- | --- |
| [Workspace editor](workspace-editor-parity.md) | Tabs, CodeMirror, Markdown, draft recovery, and file editing |
| [Workspace filesystem](workspace-filesystem-parity.md) | Watches, native file actions, and filesystem behavior |
| [Workspace detail snapshot — Oct 31](workspace-detail-parity-2026-10-31.md) | Recovered file glyphs, tree navigation, focus preservation, and tab menus |
| [Settings and integrations](settings-parity.md) | Preferences, plugins, skills, and MCP inventory |
| [Visual baseline](visual-baseline.md) | Measured shell geometry, typography, and interactive states |
| [Workbench and activity snapshot — Oct 29](workbench-activity-parity-2026-10-29.md) | Per-chat workbench state, browser behavior, and process timing |

## Reconstruction and evidence

The workflow combines direct inspection of installed source/assets, the supplied reference recording, measured UI geometry, protocol traces, and native runtime checks. It is inspired by [REA](https://github.com/morluto/rea). Claims apply to the version, source snapshot, and build stated in each record.

| Record | Scope |
| --- | --- |
| [Reverse-engineering workflow](reverse-engineering.md) | Local extraction, inspection, reconstruction, and platform limits |
| [Startup routing](reconstruction-startup-routing.md) | Profile and server isolation for the retained-runtime study build |
| [Runtime reconstruction validation](reconstruction-validation-current.md) | Checks for the retained installed renderer/runtime |
| [UI detail snapshot — Oct 29](ui-detail-parity-2026-10-29.md) | Activity, disclosure, embedded output, toolbar, and composer refinements |
| [UI detail snapshot — Oct 30](ui-detail-parity-2026-10-30.md) | Breadcrumb menus, compact controls, clipboard, and wide layouts |
| [UI detail snapshot — Oct 31](ui-detail-parity-2026-10-31.md) | Preceding 192-file/1,478-test/70-output snapshot: native command hierarchy/timer, three-tree guides and fixture diff passed; cleanup passed, complete parity remains in progress |
| [UI element snapshot — Oct 31](ui-element-parity-2026-10-31.md) | Latest210-file/1,663-test/71-output snapshot: exact-source glyphs, Changes full/word/Git filters, changed-file picker and retained chooser with bounded native checks; complete parity remains in progress |
| [Shell element audit](shell-element-audit-2026-10-31.md) | Permission, project/thread menus, titlebar and composer assets with original call-site geometry |
| [Conversation element audit](conversation-element-parity-2026-10-31.md) | Copy variants, code/raw output, MCP resource semantics and error glyphs |
| [Workbench element audit](workbench-element-parity-2026-10-31.md) | File controls, native icons and three-state diff layout |
| [Obligation ledger](../reverse/obligations.json) | Remaining reconstruction requirements |
| [Source provenance](../reverse/source-provenance.json) | Reference source and version attribution |

Historical pass counts belong to their recorded snapshots. Source tests, ASAR comparisons, retained-runtime checks, and native UI acceptance answer different questions; none alone proves complete original-app parity.

## Demo and page media

[Media notes](media/README.md) identify the deterministic demo and derived GitHub images. [Promo setup](../promo/README.md) explains how to reproduce the recording.
