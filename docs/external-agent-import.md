# External agent import: source-edition implementation

The editable macOS client now has a main/preload/shared import bridge and a working import service. The implementation follows the shipped Codex JavaScript directly. Claude Code and Cursor detection and migration use the installed app-server; Cowork has a local filesystem adapter because its desktop implementation is outside the app-server migration protocol.

## Evidence and recovered contracts

The source is `reverse/raw/source/installed/.vite/build/main-JI9qDiXp.js`, SHA-256 `b8c5d07cc3c30fbf0abe729b05434e7d1ffa19ee6c4daa818ae8f855be66d1e1`. Offsets below are zero-based character offsets in that file. The ignored source is retained locally for investigation; the delivered modules are TypeScript translations and adaptations of those behaviors.

| Original symbol | Approximate offset | Implemented behavior |
| --- | ---: | --- |
| `YCe` / `XCe` | 1,285,196 | Local-host import service, provider detection in parallel, project-root expansion and deduplication |
| `QCe` | 1,290,469 | `externalAgentConfig/detect`; Cursor sends `migrationSource:'cursor'` |
| `ewe` / `twe` | 1,291,146 | Completion listener before RPC, match returned `importId`, 120-second timeout, projectless Cursor directory rewriting |
| `PO` / `awe` / `FO` / `IO` | 1,298,436 | Provider tags, migration item conversion, empty-window session identities and output associations |
| `EE` / `ixe` / `HE` / `oSe` | 1,186,869–1,221,017 | Cowork account/org spaces, supported folder identity, local session manifests, `.claude` transcript discovery and audit fallback |
| `sbe` / `cbe` / `zbe` / `Bbe` | 1,172,175–1,181,305 | Model/permission migration, MCP transport/environment/header conversion, Markdown skills and agents |
| `Uye` / `Gye` / `Yye` / `Jye` | 1,165,532–1,167,338 | Cowork plugin cache, `.codex-plugin` metadata, local marketplace and enabled configuration |
| `Ixe` / `Yxe` / `dD` / `Bye` | 1,160,000–1,218,000 | User/assistant content conversion, historical tool text, local images, rollout creation and persistent `thread/fork` |
| `bwe` | 1,301,558 | Canonical project-root matching, create missing projects and assign only unassigned imported project sessions |

The installed CLI's experimental JSON schemas were generated locally into `reverse/raw/checks/external-agent-schema`. They confirm all ten migration item types, completion/progress payloads, import-history responses, `project/create`, `thread/metadata/update`, `thread/fork` and `mcpServer/oauth/login`.

The native Cursor JSONL verification fixture also follows `codex-rs/external-agent-migration/src/detect/sessions/cur_tests.rs` and `sessions/records_cur_tests.rs` from the public OpenAI Codex repository. Those read-only source files are retained under ignored `reverse/raw/checks`.

## Delivered implementation

`src/main/externalAgentImport.ts` owns import execution, completion listeners, project finalization, preferences and sync. `src/main/externalAgentImportCowork.ts` owns local Cowork detection and migration. The bridge is `window.codex.externalAgentImport`, with dedicated IPC validation rather than widening the generic renderer RPC allowlist.

Detection returns the original `providerId`, `cwd`, `itemType`, `description` and `details` fields, plus provider availability/error diagnostics. Cowork account setup items retain their original `sourcePath`. Requested providers are detected independently. When home detection discovers additional project roots, the service scans roots not already included in explicit workspace roots across both native providers and deduplicates the result.

Import runs providers in the observed Claude Code → Cursor → Cowork order. A provider's RPC response is an acknowledgement, so the caller waits for the matching completion notification. Notifications received before the RPC response are buffered by import ID. The service retains individual failures and successful imports, records Cowork results through the server's native history protocol, and returns imported project IDs, thread IDs and roots.

Cancellation stops future providers and Cowork items. It waits for already dispatched native work to complete because this protocol has no server-side import cancel method. A timeout rejects the original caller with an explicit uncertain-outcome message, retains the running operation, and prevents another import from being submitted. An exact late completion or exact matching persisted history entry still finalizes the result. Progress includes that final result so a page reopened after a timeout can update. A transport failure marked `outcome-unknown` also keeps the operation busy and prevents blind replay. If the acknowledgement was lost before an import ID was available, automatic attribution to an unrelated history entry is deliberately unavailable.

Cancellation during Cursor workspace preparation or Cowork configuration/directory preparation prevents the next import mutation. Disposal retires native completion waiters and prevents late responses from starting project finalization, metadata, history or profile writes. A fork result that has already returned retains its committed thread identity in memory; manual cancellation completes bookkeeping for dispatched Cowork work before stopping subsequent items. Outstanding local writes are tracked and drained during disposal, and application quit waits for the import service and terminal sessions to retire before stopping the app-server.

Project roots are matched by filesystem identity, including macOS `/var` and `/private/var` aliases. Existing project assignments are preserved. Independent Cursor and Cowork sessions get their own `Documents/Codex/<title-id>/work` and `outputs` directories and are excluded from project creation. Their output associations are persisted in the replica profile.

Preferences live in `external-agent-import.json` under the replica's own user-data directory. A new profile starts with sync disabled and no connected import sources. Successful imports record their source providers and preserve explicit category preferences. The recovered default session limits are 30 days and 50 sessions per space. Sync supports `null`, `'all'`, or the original category map with boolean/`'original'` values; it checks on startup and then every minute while enabled. Disabling sync during pending detection prevents a later mutation, and disabling an active sync requests stopping subsequent providers. Sync preference writes are serialized and atomic.

MCP authentication is an explicit Settings action. The main process requests `mcpServer/oauth/login`, validates the server-returned HTTPS URL and opens the system browser. It does not reuse the account-login broker's OpenAI-only hostname policy for third-party MCP providers.

## Validation

`npx vitest run src/main/externalAgentImport.test.ts src/main/externalAgentImportCowork.test.ts` passes **24 tests**: 21 import-service tests and 3 Cowork lifecycle tests. They cover notification-before-response races, ID ownership, progress buffering, listener cancellation, timeout cleanup, retained uncertain operations, exact-history recovery, no duplicate submission, stop-after-current-provider semantics, cross-provider root discovery, canonical project matching, Cursor independent paths, partial results, provider preference recording, category filtering, disabling sync during detection, Cowork source formats and IPC validation. Lifecycle cases also cover cancellation during preparation, retiring completion waiters, preventing post-disposal finalization/history/profile calls, preserving returned fork results and draining tracked writes.

`node scripts/verify-external-agent-import.mjs` runs the installed CLI with an isolated temporary `HOME`, `CODEX_HOME`, XDG directories, replica profile and source directories. It verifies:

- Claude Code project instructions migrate to `AGENTS.md`, including the server's Claude → Codex text adaptation, and create one project.
- Cowork project and independent JSONL histories create two persistent threads. A stored turn is readable, titles persist, the project session joins the existing canonical project, and the independent session has no project assignment.
- Cowork Markdown skills and agents migrate, enabled MCP configuration is written, disabled MCP sources are excluded, and generated deliverables are copied.
- A Cowork plugin is present in the cache and local marketplace, and native `plugin/list` reports it installed and enabled.
- A Cursor empty-window JSONL history creates one persistent independent thread with a canonical cwd matching its generated workspace and creates no project.
- Native history reports the resulting three imported sessions.

The latest machine-readable result is `reverse/raw/checks/external-agent-import-current.json`. No real user configuration or history is read or imported by the verification, and no model turn is started. The fixture MCP command is `/usr/bin/false` and runs only under the isolated profile.

## Remaining differences

This establishes the listed working scope, not complete external-import parity. Cowork cloud sessions without local transcripts are reported and skipped. Claude extension bundles, `.operon` configuration, live artifact reconstruction, merging multiple transcript revisions/branches, source session append/update behavior, every plugin layout/version collision and all account preference fields still need additional recovery and fixtures. The adapter supports the demonstrated local formats; it does not label those unverified formats as successfully migrated.

The original desktop owns a separate global project store. This source edition uses the app-server project catalog and canonical thread metadata, so original imported-project timestamp/order adjustments are not identical. Detailed native item progress is also optional under the existing observed notification opt-outs; provider stages and the real completion result always remain available. Pixel-level Settings and review-dialog acceptance belongs to the renderer validation rather than these protocol tests.
