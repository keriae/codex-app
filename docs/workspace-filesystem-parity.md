# Workspace watches and file actions

This pass continues direct inspection of the installed 26.1016.62342 / 21477 artifacts. It does not use a clean-room process. The original installation and its native authorization checks remain unchanged.

## Recovered source

`webview/assets/app-initial-dddef47d6ef6.js` (SHA-256 `1fc7b685efab4be2d9656e02086180dd9e43dcac0fae1e2b1ec233447ed03843`) contains the open-file watch registry around offsets 2,449,000–2,453,754. It groups owners and paths, registers `fs/watch {path,watchId}`, emits `open-file-changed`, and sends `fs/unwatch` when the final owner disappears. Pending starts remember cancellation so they are unwatched after a late successful response. Review files distinguish manual source-change notices from automatic refetches.

`webview/assets/base-file-tree-affb6fed9f95.js`, function `ke`, defines preferred-app and Open in submenu actions followed by a separator, Save as…, Copy path, and Add to chat. `selectAfterClose` is explicitly set for Add to chat. `workspace-file-context-menu-trigger-eaed490c4790.js` reexports the original implementation. These source modules and the recording were used alongside the earlier actual REA selected-source analyses documented in `workspace-editor-parity.md`.

## Connected implementation

`WorkspaceWatchers` provides a bounded local macOS adapter for this lifecycle. It watches expanded directories and the parents of open documents without recursively traversing the project. Directory metadata polling detects deleted/replaced directory inodes and rearms a nonrecursive watcher after canonical containment is revalidated. Every existing file and directory must resolve within a main-granted root. Missing files keep their parent subscription, and missing expanded directories can recover on recreation. Native subscriptions belong to a window and renderer-document generation; reload, process loss, and quit dispose them, including late starts.

The renderer subscribes before native startup, buffers early events, and ignores other roots and subscription IDs. Closing/replacing a pane releases a subscription even if its ID arrives later. Once native startup returns its ID, buffered events are replayed and a baseline refresh covers changes made before the watcher was installed. Collapsing the panel retains open-file watches while releasing directory watches; reentering a chat refreshes retained documents after its new watcher is ready. Directory reads and document reloads have independent generations. Clean documents refresh automatically; dirty documents retain their draft and show a disk conflict. Deletion, changed file type, and failed reads retain text. A change during a save triggers a fresh read after the save settles.

The tree menu uses actual installed app targets, the existing preferred Finder/Terminal setting, macOS Finder/Terminal/editor opening, exact path copying, and a real native Save dialog. Save as exports the current text draft when the file is open, otherwise copies the source bytes (including binary/image files). Cancellation writes nothing. Source grants and canonical paths are checked before and after the dialog; renderer input cannot provide an export destination. Native copy writes beside the selected destination and atomically replaces it.

Add to chat closes the menu before inserting a file reference into the current composer. Editor selections use the same event with the original zero-based, exclusive-end line/character range. References are validated against the current workspace; insertion never starts a turn. Split view keeps the open file; full view uses the existing return-to-chat behavior to expose the draft.

## Verification

Native fixture tests cover file atomic replacement, creation, directory deletion/recreation, missing-file recovery, owner teardown, late starts, bounded requests, out-of-root symlinks, binary/text exports, cancellation and stale dialog completion. Renderer tests cover early notifications, stale subscription disposal, out-of-order reads, deletion/type-change draft preservation, and changes received during an in-flight save. Native UI acceptance and final package results are recorded under `reverse/raw/checks/current/` after packaging.

The native fixture at `filesystem/native-report.json` verified atomic replacement notifications, no notifications after unwatch, rejection of `/tmp` outside the project, and actual installed Terminal/Finder/Cursor targets. Native macOS input exposed the README tree menu and saved a copy through the real Save dialog. The exported **8,701 bytes** matched README exactly, SHA-256 `f6a073b17ceb2e3dd484863b5fa868cc6ea98654ac3d310e9b759ffadbbf4d95`. `filesystem/native-ui.json` retains the interaction assertions.

The 2026-10-24 acceptance package's `filesystem/baseline-report.json` passed native folded-file notifications and clean-document refresh, then Settings unmount/reentry with latest disk content and retained tabs/source mode. That snapshot's complete source suite passed **132 files / 927 tests**, and **100/100** build files matched the package; signature, fuses, typechecks and renderer/backend checks passed. See `docs/source-validation-current.md` for the current release checks and the exact native acceptance boundaries.

This is functional parity for these local actions, not proof of full visual equivalence. The editable implementation uses its existing app-target preference and the enumerated local editor targets; the original renderer supports a larger set of configurable opener targets. Remote-host watches and manual review-source refresh modes are outside this macOS local adapter.
