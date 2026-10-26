# Thread and project operations

This note is the implementation contract for the local macOS clone's thread
catalog, history hydration, thread mutations, project assignment, pin/read
presentation state, and active-turn steering. It deliberately contains no real
thread ids, titles, prompts, paths, or account data.

## Evidence and version baseline

The baseline is the installed desktop target `26.1016.61520` (build `21421`),
its bundled app-server `0.163.0-alpha.11.1`, and the locally installed
`codex-cli 0.163.0`.

The protocol bundle used for this note was generated with:

```bash
codex app-server generate-json-schema --experimental --out /tmp/codex-schema.BVPZiK
```

The v2 bundle
`codex_app_server_protocol.v2.schemas.json` is 776,525 bytes and has SHA-256
`a000c50ceb59e6a9b668f9b638bfce1df6fcd59a383aaa38291ed72c96fa92e0`.
It is temporary evidence and must not be committed. The public reference is
the [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

Evidence labels used below:

- **O — original observed**: a sanitized static call site, response reducer,
  notification handler, or user-facing action exists in the installed target.
  This does not imply a destructive operation was executed against user data.
- **P — protocol only**: present in the generated schema and/or official
  documentation, but no corresponding target call site was found.
- **U — unknown/version-skewed**: sources disagree, or the emission/behavior
  could not be established without mutating real state.

Read-only wire shapes (`thread/list` and `thread/read`) were also exercised
against a local `0.163.0` app-server. No returned user/thread fields are quoted,
persisted, or used as fixtures here.

## Important version skew

The current public documentation describes `isPinned` on `Thread`, an
`isPinned` filter on `thread/list`, and an `isPinned` patch on
`thread/metadata/update`. The generated `0.163.0 --experimental` schema used
here contains none of those fields. The installed target instead has a
desktop-owned ordered pin store and can optionally consult app-server pins on
hosts that advertise that newer capability.

Therefore the clone must not send or depend on app-server `isPinned` for this
baseline. Pin state is a local presentation concern until runtime capability
detection proves otherwise. This is **U**, not a license to silently accept the
newer documentation as the target wire contract.

The generated bundle also includes experimental additions such as durable read
receipts, `thread/search`, project/section fields, and parent/ancestor filters.
The target initializes with `capabilities.experimentalApi: true`, but it still
does not use every experimental method.

## Wire conventions and shared objects

Every operation is a JSONL request of the form `{ method, id, params }`; the
response is `{ id, result }` or `{ id, error }`. Notifications have no `id`.
Correlate exclusively by request id and never assume response ordering.

All cursors are opaque. A cursor is valid only with the same method, filters,
sort key, and sort direction that produced it, except where a documented
`backwardsCursor` explicitly permits reversing direction. Keep a per-load set
of seen cursors and stop with an error state if the server repeats a cursor.

Relevant `Thread` fields in this schema are:

```ts
type Thread = {
  id: string
  sessionId: string
  forkedFromId?: string | null
  parentThreadId?: string | null
  preview: string
  name?: string | null
  ephemeral: boolean
  historyMode?: "legacy" | "paginated"
  projectId: string | null
  section?: ThreadSection | null
  modelProvider: string
  model?: string | null
  reasoningEffort?: string | null
  cwd: string
  gitInfo?: { sha: string | null; branch: string | null; originUrl: string | null } | null
  createdAt: number
  updatedAt: number
  recencyAt?: number | null
  status: ThreadStatus
  turns: Turn[]
  // The schema has additional source, environment, agent, and path metadata.
}

type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: ("waitingOnApproval" | "waitingOnUserInput")[] }
```

`turns` is populated only by `thread/read` with `includeTurns: true`, or by
non-excluded `thread/resume`/`thread/fork`. For list, mutation, and lifecycle
payloads it is empty. New code should page history instead of requesting full
history.

The JSON Schema often requires only `data` or `thread` while generated
TypeScript marks nullable cursor fields as present. For compatibility, normalize
an absent `nextCursor`, `backwardsCursor`, `readState`, or history cursor to
`null` at the transport boundary.

## Catalog: list, search, read state

### `thread/list` — O

Exact parameters for this baseline:

| Field | Type | Required | Semantics |
| --- | --- | --- | --- |
| `cursor` | `string \| null` | no | Opaque continuation cursor. |
| `limit` | `uint32 \| null` | no | Server default when omitted. |
| `excludedThreadIds` | `string[] \| null` | no | Maximum 100; invalid ids or a larger array are rejected. Repeat the same exclusions on every page. |
| `sortKey` | `created_at \| updated_at \| recency_at \| section_position` | no | Defaults to `created_at`. |
| `sortDirection` | `asc \| desc` | no | Defaults to `desc`. |
| `modelProviders` | `string[] \| null` | no | Empty means all providers. |
| `sourceKinds` | `ThreadSourceKind[] \| null` | no | Omitted/empty defaults to interactive sources. |
| `originators` | `string[] \| null` | no | Hosted backends only; local app-server rejects a non-empty list. |
| `archived` | `boolean \| null` | no | `true` lists archived only; otherwise active only. |
| `sectionId` | `string \| null` | no | Omitted = any section; explicit `null` = unsectioned. |
| `projectId` | `string \| null` | no | Omitted = any project; explicit `null` = unassigned. |
| `cwd` | `string \| string[] \| null` | no | Exact cwd match; relative paths resolve from the server process cwd. |
| `useStateDbOnly` | `boolean` | no | `true` skips JSONL scan-and-repair. |
| `searchTerm` | `string \| null` | no | Substring filter on the extracted title, not transcript search. |
| `parentThreadId` | `string \| null` | no | Direct children; mutually exclusive with `ancestorThreadId`. |
| `ancestorThreadId` | `string \| null` | no | Descendants at any depth, excluding the ancestor. |

`ThreadSourceKind` is one of `cli`, `vscode`, `exec`, `appServer`, `subAgent`,
`subAgentReview`, `subAgentCompact`, `subAgentThreadSpawn`, `subAgentOther`, or
`unknown`. Parent/ancestor filters are experimental.

Result:

```ts
type ThreadListResult = {
  data: Thread[]
  nextCursor?: string | null
  backwardsCursor?: string | null
  readStates?: Record<string, ThreadReadState> | null
}
```

`nextCursor: null` means exhausted. `backwardsCursor` is populated only when a
page has rows; use it with the opposite direction. For timestamp sorts it
anchors at the page's starting timestamp so same-second updates are not skipped.
Filters run before the limit.

Target behavior observed statically:

- Recent history requests `useStateDbOnly: true`, non-archived interactive
  sources, and a compatible recency sort. Ordinary pages are 50 rows; expanded
  discovery may request up to 100.
- Full archive scans use 100-row pages and recurse until `nextCursor` is null.
- Repeated cursors are treated as a server fault rather than retried forever.
- List responses are filtered again for target-specific source visibility.

Safe UX:

- Key list caches by the complete filter tuple; changing any filter starts a
  fresh generation and invalidates prior cursors.
- Merge by `thread.id`, but preserve server page order.
- Do not log `preview`, `name`, `cwd`, or search input at normal telemetry
  levels.
- A failed later page must not erase already rendered rows; show an inline
  retry affordance for that page.

### `thread/search` — O

The target uses the dedicated search method for chat search instead of
`thread/list.searchTerm` because it returns content snippets.

```ts
type ThreadSearchParams = {
  searchTerm: string
  cursor?: string | null
  limit?: number | null
  sortKey?: "created_at" | "updated_at" | "recency_at" | null
  sortDirection?: "asc" | "desc" | null
  sourceKinds?: ThreadSourceKind[] | null
  archived?: boolean | null
}

type ThreadSearchResult = {
  data: { thread: Thread; snippet: string }[]
  nextCursor?: string | null
  backwardsCursor?: string | null
}
```

The observed desktop path trims the query, returns no results for an empty
query, defaults its UI cap to 50, searches non-archived interactive sources,
and guards against repeated cursors. Search snippets are sensitive transcript
material: render them, but never include them in logs, crash reports, or test
snapshots.

`thread/searchOccurrences` is **P**. It searches visible user messages and
partial/final assistant answers within one paginated thread using a
case-insensitive literal substring. Its result is chronological occurrences
with `turnId`, `itemId`, `snippet`, a UTF-16 `snippetMatchRange`, and an inclusive
`turnCursor`; the target has no call site for it.

### Durable read receipts — P for protocol, O for local target UX

Experimental protocol state:

```ts
type ThreadReadState = {
  firstUnread:
    | null
    | { type: "threadStart" }
    | { type: "turn"; turnId: string }
  revision: string
}

// request: thread/readState/update
type UpdateReadStateParams = {
  threadId: string
  operation: { type: "read" } | { type: "unread" }
  expectedRevision: string
}

type UpdateReadStateResult = { readState: ThreadReadState }

// notification: thread/readState/changed
type ReadStateChanged = { threadId: string; readState: ThreadReadState }
```

`thread/list.readStates` is keyed by thread id. `null` means durable receipts
are unavailable; a missing key means that row is ineligible. `thread/read` may
similarly return `readState: null` or omit it. `firstUnread: null` means read.
The `revision` is an optimistic-concurrency token: a conflict requires a fresh
user action after loading the latest receipt, not an automatic blind retry.

The installed target exposes “Mark as read/unread”, but stores unread thread ids
in desktop-owned, host-keyed local storage and broadcasts changes between app
windows. It opts out of `thread/readState/changed`, and no static
`thread/readState/update` call site exists. It only tolerates optional
`readStates` fields in list data. The baseline clone should reproduce that
local behavior first, behind an adapter that can later use durable receipts
when a negotiated server capability is available.

## Read, resume, and history pagination

### `thread/read` — O

```ts
// request
{ threadId: string; includeTurns?: boolean }

// result
{ thread: Thread; readState?: ThreadReadState | null }
```

Omit `includeTurns` or send `false` for metadata only. `true` hydrates full
history, is deprecated for paginated threads, and can emit a deprecation
notice. `thread/read` neither loads/subscribes the thread nor emits
`thread/started`.

The target uses metadata-only reads for background hydration and archive
coordination. It retains `includeTurns: true` only as a legacy-history fallback.
Cache `thread_not_found` separately from transient transport failures so a stale
sidebar row can be removed without suppressing retries for real outages.

### `thread/resume` — O

Required parameter: `threadId: string`.

Optional parameters:

- Source selection: unstable `history: ResponseItem[] | null` and
  `path: string | null`. For a non-running thread precedence is non-empty
  `history`, then non-empty `path`, then `threadId`. For a running thread,
  `threadId` rejoins it and a non-empty path is only a consistency check.
- Runtime/config overrides: `model`, `modelProvider`, `serviceTier`, `cwd`,
  `runtimeWorkspaceRoots`, `approvalPolicy`, `approvalsReviewer`, `sandbox`,
  `permissions`, `config`, `baseInstructions`, `developerInstructions`, and
  deprecated `personality`. `permissions` and `sandbox` are mutually exclusive;
  workspace roots must be absolute.
- History bootstrap: `excludeTurns?: boolean` and
  `initialTurnsPage?: { limit?, sortDirection?, itemsView? } | null`.

Wire-required result fields are `thread`, `model`, `modelProvider`, `cwd`,
`approvalPolicy`, `approvalsReviewer`, and `sandbox`. Version-dependent/defaulted
fields include `serviceTier`, `disabledPluginIds`, `runtimeWorkspaceRoots`,
`instructionSources`, `activePermissionProfile`, `reasoningEffort`,
`collaborationMode`, deprecated `multiAgentMode`, `initialTurnsPage`,
`turnsBackwardsCursor`, and `itemsBackwardsCursor`.

The target's paginated path requests `excludeTurns: true` where supported. It
can request an initial page of five newest turns with full items, then falls
back to `thread/turns/list`; only legacy history falls back to a full
`thread/read`. Resuming by itself must not be treated as a recency update; the
public contract says recency changes when a new turn starts.

On success, resume subscribes the connection to the thread's turn/item stream.
Do not render the thread as “ready” until the response has been reconciled with
any buffered notifications that arrived during resume.

### `thread/turns/list` — O

```ts
type ThreadTurnsListParams = {
  threadId: string
  cursor?: string | null
  limit?: number | null
  sortDirection?: "asc" | "desc" | null // default desc
  itemsView?: "notLoaded" | "summary" | "full" | null // default summary
}

type ThreadTurnsListResult = {
  data: Turn[]
  nextCursor?: string | null
  backwardsCursor?: string | null
}
```

Newest-first is the default. `backwardsCursor` is used with the opposite sort
direction and deliberately includes the anchor turn again, allowing clients to
catch changes to it. Deduplicate that overlap by turn id.

`itemsView` is a contract, not a hint:

- `notLoaded`: `items` is intentionally empty.
- `summary`: only display summary items are present.
- `full`: all available persisted items are present.

The target commonly loads turns as `notLoaded`, then hydrates items separately;
it rejects an unchanged cursor. Never infer “turn has no items” when
`itemsView` is `notLoaded`.

### `thread/items/list` — O

```ts
type ThreadItemsListParams = {
  threadId: string
  turnId?: string | null
  cursor?: string | { type: "item"; itemId: string } | null
  limit?: number | null
  sortDirection?: "asc" | "desc" | null // default asc
}

type ThreadItemEntry = {
  turnId: string
  item: ThreadItem
  startedAtMs?: number | null
  completedAtMs?: number | null
}

type ThreadItemsListResult = {
  data: ThreadItemEntry[]
  nextCursor?: string | null
  backwardsCursor?: string | null
}
```

Omitting `turnId` pages across the thread. An object item anchor requires a
non-empty `turnId` and is exclusive: ascending returns items after it;
descending returns items before it. Missing turn id, empty/unknown item id, or
an item outside the requested turn returns invalid params (`-32602`). After the
first anchored page, continue with the returned string cursor.

The target verifies every returned entry belongs to the requested turn, guards
against repeated cursors, and reduces page size when a response exceeds the
transport's decoded-message limit. Reducers must merge by item id and use
`item/started`/`item/completed` notifications to upgrade paged snapshots.

## Naming and lifecycle mutations

### `thread/name/set` — O

```ts
// request
{ threadId: string; name: string }

// result
{}

// notification: thread/name/updated
{ threadId: string; threadName?: string | null }
```

The target persists titles through this method and handles the notification.
Its reducer ignores absent, empty, or whitespace-only notification titles.
Recommended UX is optimistic text with a per-thread pending write, rollback on
request error, and final reconciliation from the notification or a later
`thread/read`. Do not let an older rename response overwrite a newer local edit.

### `thread/archive` — O

```ts
// request/result
{ threadId: string } -> {}

// notification, one per archived thread
thread/archived { threadId: string }
```

The server moves the persisted rollout into the archive and attempts to archive
spawned descendants that are not already archived. The request may succeed even
if a descendant could not be archived; notifications enumerate threads actually
archived. Archived rows appear only under `thread/list { archived: true }`.

The target has direct request and notification handling, plus separate pin and
worktree cleanup coordination. Treat the operation as reversible but
potentially cascading: remove each notified id from active views, not merely the
requested root. Keep an undo affordance that invokes unarchive. If a linked
managed worktree may be cleaned up, that is a separate destructive choice and
must be surfaced explicitly.

### `thread/unarchive` — O

```ts
// request
{ threadId: string }

// result
{ thread: Thread }

// notification
thread/unarchived { threadId: string }
```

Use the returned thread as the authoritative active-row snapshot. The target
prepares an owned loaded thread by unsubscribing before restore, then hydrates
the restored thread. Make unarchive idempotent in the UI: duplicate response and
notification delivery must upsert one row, not create duplicates.

### `thread/delete` — O

```ts
// request/result
{ threadId: string } -> {}

// notification, one per deleted thread
thread/deleted { threadId: string }
```

Delete permanently removes an active or archived persisted thread and its
spawned descendants. Missing rollout files count as already deleted. Ephemeral
root threads cannot be deleted through this method.

Safety UX is mandatory:

- Default the primary action to archive; put delete behind a destructive
  confirmation that names the descendant cascade.
- Explain that deletion removes conversation history, not necessarily local
  repository/worktree files; any file cleanup is a separate operation.
- Disable duplicate submissions and active editing while confirmation is open.
- On success, remove every id received via `thread/deleted`; also evict local
  read state, pin state, pagination state, pending title writes, and subscriptions.
- Never implement undo by recreating a thread with copied content; deletion has
  no protocol undo.

## Fork, compact, and revert

### `thread/fork` — O

Required: `threadId: string`.

Optional fields are:

- History cut: `lastTurnId` (inclusive) or `beforeTurnId` (exclusive); they are
  mutually exclusive. An in-progress `lastTurnId` is rejected.
- Source/config: unstable `path`, `model`, `modelProvider`, `serviceTier`,
  `cwd`, `runtimeWorkspaceRoots`, `approvalPolicy`, `approvalsReviewer`,
  `sandbox`, `permissions`, `config`, `baseInstructions`,
  `developerInstructions`, and `threadSource`.
- Lifecycle: `ephemeral`, `excludeTurns`, and `deferGoalContinuation`.
- `experimentalPredictionMode`: requires a loaded persisted parent and
  `ephemeral: true`; it conflicts with config overrides, `path`, `lastTurnId`,
  and `beforeTurnId`.

For paginated history, an ephemeral fork requires `excludeTurns: true`.

The response contains a new `thread` plus the effective `model`, provider,
service tier, cwd, runtime roots, instruction sources, approval/sandbox/profile
state, reasoning effort, disabled plugin ids, and deprecated multi-agent mode.
The server emits:

```ts
thread/started { thread: Thread }
```

The new thread should expose `forkedFromId` when available. Persistent forks
stay in the source session tree (`sessionId`); ephemeral fork session behavior
is server-defined and must be read from the returned `thread.sessionId`.

The target uses both inclusive `lastTurnId` and exclusive `beforeTurnId`, sends
`excludeTurns: true` for persistent and side-conversation forks, and follows
with paginated hydration. Safe UX should preview the cut point, prevent forking
from an unresolved in-progress turn, and navigate only after the response yields
the new id. If post-fork UI placement fails, preserve the successfully created
thread and report only the placement failure.

### `thread/compact/start` — O

```ts
{ threadId: string } -> {}
```

The empty result acknowledges that compaction was accepted, not completed.
Progress arrives as ordinary `turn/started`, `item/started`,
`item/completed`, and `turn/completed` events. The item has
`{ type: "contextCompaction", id }`.

The deprecated `thread/compacted` notification exists in the schema, but the
target opts out of it and has no reducer for it. The target creates a temporary
pending compaction item until the real item lifecycle arrives. The clone should
do the same, disable duplicate manual compactions while pending, and clear the
synthetic state on request error, real item start, disconnect, or terminal turn
failure.

### `thread/revert` — O

```ts
// request
{ threadId: string; beforeTurnId: string }

// result
{
  thread: Thread // turns is always []
  turnsBackwardsCursor?: string | null
  itemsBackwardsCursor?: string | null
}

// notification
thread/reverted { threadId: string }
```

The operation replaces a loaded, persistent, paginated thread's durable history
with the prefix before `beforeTurnId`; that turn and every later turn are
removed. Legacy and ephemeral history are unsupported. It does **not** revert
local file changes.

The target calls revert for edit/retry flows, waits for the response, applies
the response and returned cursors, and opts out of `thread/reverted`. It blocks
editing while any turn is in progress and normally limits edit-in-place to the
most recent user message.

Safe UX:

- State clearly that conversation history is removed while filesystem changes
  remain.
- Offer “fork from here” as the non-destructive alternative.
- Do not optimistically delete transcript nodes before success.
- Invalidate item pages for removed turns, then hydrate retained history from
  the returned cursors with descending order; the cursor anchor is included.
- If the connection drops after an unknown outcome, re-read metadata/history
  before allowing another revert.

`thread/rollback` is legacy and outside the clone contract; current public
documentation says it is removed, although the target retains a compatibility
fallback for older servers.

## Metadata, projects, and pins

### `thread/metadata/update` — O for Git/Daybreak, P for project assignment

```ts
type ThreadMetadataUpdateParams = {
  threadId: string
  projectId?: string | null
  gitInfo?: {
    sha?: string | null
    branch?: string | null
    originUrl?: string | null
  } | null
  daybreakEnabled?: boolean | null
}

type ThreadMetadataUpdateResult = { thread: Thread }
```

Patch rules:

- Omitted fields remain unchanged.
- `projectId: ""` clears the assignment; a non-empty id assigns an existing
  project. Although the wire type also admits `null`, the schema description
  only promises omit/empty-string/non-empty semantics, so do not use null to
  clear without a behavioral probe.
- Within `gitInfo`, omitted keys remain unchanged, explicit `null` clears, and
  a non-empty string replaces the value.
- `daybreakEnabled: null` means unchanged; it does not grant or select a cyber
  access program for a turn.

The target has call sites for changing the stored Git branch and Daybreak
choice. No target call site was found for `projectId`. The schema also defines
`thread/project/updated { threadId, projectId }`, but the target opts out of
that notification and the public page does not establish whether every metadata
patch emits it; treat that emission relationship as **U**. Reconcile project
assignment from the mutation response and a later list/read refresh.

Project list filters must distinguish three states: field omitted = all
projects, explicit `null` = unassigned, string = one project. Do not collapse
omitted and null when constructing cache keys.

### Pinning — O for desktop behavior, U for app-server wire

For this target version, pins are an ordered desktop-owned list keyed by host.
The target supports pin, unpin, ordering before another thread, cross-window
broadcast, undo, and cleanup on archive/delete. Its app-server catalog keeps a
separate `pinnedConversationIds` set so pinned rows remain visible even when
they fall outside the recent-history limit.

Minimum clone contract:

```ts
type LocalPins = Record<HostId, ThreadId[]> // order is significant
```

- Persist atomically; deduplicate ids while preserving the first occurrence.
- Pin/unpin is optimistic with rollback and undo.
- Remove ids on delete. Archive should hide the row from the active pinned
  surface while preserving or clearing the pin according to the observed
  desktop coordination path; keep this decision in one policy function.
- On startup, prune ids that are confirmed missing, but do not prune on a
  transient list/read failure.
- Add an app-server pin adapter only after schema/capability detection confirms
  `isPinned`; never infer support from the public docs alone.

## `turn/steer` — O

```ts
type TurnSteerParams = {
  threadId: string
  input: UserInput[]
  expectedTurnId: string
  clientUserMessageId?: string | null
  additionalContext?: Record<string, AdditionalContextEntry> | null
  responsesapiClientMetadata?: Record<string, string> | null
}

type TurnSteerResult = { turnId: string }
```

The request appends input to the currently active turn. There must be an active
turn and `expectedTurnId` must match it. It accepts no turn-level model, cwd,
sandbox, or output-schema overrides, and it does not emit a new
`turn/started`. The returned `turnId` is the accepted active turn.

The target creates an optimistic steering-message item, waits until an active
turn id exists, sends the id as a precondition, and reconciles the returned id.
It has a bounded recovery path for an expected-turn mismatch; the clone should
instead prefer a fresh status/turn reconciliation and at most one user-visible
retry, never an unbounded automatic loop.

Disable steer when the thread is not loaded/active, when a stop is pending, or
when the active turn id is unknown. If the turn finishes while the user submits,
offer to send the text as a new turn rather than silently changing semantics.

## Notification reconciliation matrix

| Operation | Immediate authoritative result | Notification/event stream | Target behavior |
| --- | --- | --- | --- |
| list/search/read | page or thread snapshot | none required | O |
| resume/fork | effective thread/runtime snapshot | `thread/started`, then status/turn/item events | O |
| rename | `{}` | `thread/name/updated` | O; handles notification |
| archive | `{}` | one `thread/archived` per actual archived id | O; handles notification |
| unarchive | restored `thread` | `thread/unarchived` | O; handles both idempotently |
| delete | `{}` | one `thread/deleted` per actual deleted id | O; handles notification |
| compact | `{}` means accepted | turn/item lifecycle with `contextCompaction` | O; deprecated compact notification suppressed |
| revert | updated thread plus history cursors | `thread/reverted` | O; target suppresses notification and trusts response |
| metadata | updated `thread` | project notification relationship U | O/P/U by field |
| read state | updated receipt | `thread/readState/changed` | P; target uses local storage and suppresses notification |
| steer | accepted active `turnId` | existing turn continues; no new `turn/started` | O |

Always make response and notification reducers idempotent. A notification may
arrive before its request response, after it, twice after reconnect, or in a
different window.

## Recommended minimal state machine

Use orthogonal state instead of one giant enum:

```ts
type Residency =
  | { type: "unknown" }
  | { type: "unloaded" }
  | { type: "resuming"; generation: number }
  | { type: "loaded"; runtime: ThreadStatus }
  | { type: "resumeError"; error: Error }

type Visibility = "active" | "archived" | "deleted"

type Mutation =
  | { type: "none" }
  | { type: "renaming"; requestId: string; previousName: string | null }
  | { type: "archiving" | "unarchiving" | "deleting"; requestId: string }
  | { type: "forking" | "reverting" | "metadata"; requestId: string }
  | { type: "compacting"; requestId: string; accepted: boolean }
  | { type: "steering"; requestId: string; expectedTurnId: string }

type History = {
  turns: Map<string, Turn>
  turnOrder: string[]
  turnsNextCursor: string | null
  turnsBackwardsCursor: string | null
  turnItems: Map<string, {
    items: Map<string, ThreadItemEntry>
    order: string[]
    nextCursor: string | null
    backwardsCursor: string | null
    view: "notLoaded" | "summary" | "full"
  }>
}
```

Keep catalog query state separately by a canonical query key:

```ts
type CatalogPageState = {
  generation: number
  phase: "idle" | "loading" | "ready" | "loadingMore" | "error"
  orderedIds: string[]
  nextCursor: string | null
  backwardsCursor: string | null
  seenCursors: Set<string>
}
```

Transition rules:

1. List/search response upserts thread metadata and page order only; it never
   marks a thread loaded.
2. `thread/read` updates metadata/read receipt but leaves residency unloaded.
3. Successful resume/fork sets residency loaded and starts/binds the stream.
4. `thread/status/changed` updates only runtime status; `notLoaded` must not
   delete catalog metadata.
5. Archive/unarchive/delete update visibility idempotently for every notified
   id and cancel incompatible pending mutations.
6. Turn/item notifications merge into history only for the current stream
   generation; buffer them while resume is unresolved.
7. Revert increments a history generation, removes affected turns, discards
   their item cursors, and installs the returned backwards cursors.
8. Compact remains pending after RPC success until its item/turn lifecycle ends.
9. Read state and pins are presentation state keyed by host and thread id; they
   must survive catalog eviction but be cleared on confirmed deletion.

## Test matrix

| Area | Required cases |
| --- | --- |
| JSONL/correlation | Out-of-order responses; response plus notification race; duplicate notification; unknown id; missing optional nullable fields. |
| List pagination | Empty page; final null cursor; repeated cursor; same-second backwards traversal; filters before limit; exclusions repeated; >100 exclusions rejected; filter change invalidates cursor. |
| Search | Trimmed empty query; snippet privacy; multiple pages; duplicate ids/snippets; repeated cursor; archived/non-archived separation; `thread/list.searchTerm` not substituted for content search. |
| Read state | `null`, absent, ineligible key, read, thread-start unread, turn unread; stale `expectedRevision` has no auto-retry; local fallback persists per host and syncs windows. |
| Read/resume | Metadata-only read does not subscribe; paginated resume with `excludeTurns`; initial page present/absent; buffered notification before response; legacy full-history fallback; thread-not-found vs transient failure. |
| Turn pagination | `notLoaded`/`summary`/`full`; reverse-direction anchor dedupe; unchanged cursor; concurrent new turn while paging; page error preserves existing transcript. |
| Item pagination | Asc/desc; exclusive item anchor; missing turn id; wrong-turn entry rejected; page-size backoff; started/completed snapshot upgrade; repeated cursor. |
| Rename | Optimistic success; error rollback; old response after newer edit; empty notification ignored; reconnect refresh. |
| Archive/unarchive | Root plus descendant notifications; partial descendant archive; duplicate notification; undo; active list/archive list cache updates; pin/read cleanup policy. |
| Delete | Confirmation; active and archived roots; descendant cascade; missing file idempotency; ephemeral rejection; unknown outcome after disconnect; no protocol undo. |
| Fork | Full fork; inclusive last turn; exclusive before turn; conflicting cut fields; in-progress cut rejection; ephemeral plus `excludeTurns`; notification-before-response; placement failure preserves thread. |
| Compact | Empty result is only acceptance; synthetic pending item; real context-compaction lifecycle; request failure; terminal turn failure; duplicate click; disconnect recovery. |
| Revert | Unsupported legacy/ephemeral; in-progress UI block; before-turn exclusion; no filesystem rollback claim; response cursors installed; suppressed notification; unknown-outcome re-read. |
| Metadata/project | Partial Git patch; explicit null clear; Daybreak null unchanged; project omitted vs null vs empty string; updated thread authoritative; project notification absent. |
| Pin version skew | Target schema without `isPinned`; local ordered pins; newer capability adapter; undo/reorder; transient missing thread does not prune. |
| Steer | No active turn; unknown id; expected-id match; mismatch; turn completes during submit; optimistic item rollback; no extra `turn/started`; at most one recovery attempt. |
| Privacy | Fixtures contain synthetic ids/text only; logger redacts title, preview, cwd, snippets, user input, and item content. |
