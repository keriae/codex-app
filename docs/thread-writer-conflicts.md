# Reading a chat owned by another writer

The replica now separates a loaded transcript from runtime writer ownership.
Selecting a chat whose writer belongs to another client loads its metadata and
turns, keeps native history pagination, and provides a manual reconnect action.
It does not stop the other writer, unsubscribe it, replay a turn, or treat a
successful history read as a successful `thread/resume`.

## Direct shipped-source evidence

Inspected on 2026-10-24 from the installed macOS desktop version
`26.1016.62342`, build `21477`, archive
`/Applications/ChatGPT.app/Contents/Resources/app.asar`.

Extracted renderer file:
`reverse/raw/source/installed/webview/assets/app-initial-dddef47d6ef6.js`.
SHA-256:
`1fc7b685efab4be2d9656e02086180dd9e43dcac0fae1e2b1ec233447ed03843`.
The offsets below are JavaScript string character offsets, not byte offsets.

| Function / character offset | Observed behavior |
| --- | --- |
| `Bon`, 2619227 | Lowercases the error message and recognizes `already has an active writer` and `already has a live local writer`. |
| `Won`, 2619964 | Reads thread metadata with `includeTurns:false`, handles history independently of the runtime resume, and checks whether the current resume attempt still owns the route. |
| `Won` catch, 2643851 | On a writer conflict with paginated history, calls `ptn` to hydrate transcript history. Removes an unconfirmed owner role and restores `resumeState=needs_resume`. |
| `ptn`, 2478563 | Hydrates native turns through timeline/turn pagination, reverses descending turns, merges history and records the older cursor without acquiring a writer. |
| `EGl`, 11944759 | Treats a conversation as an automation writer only when resume state is `resumed` and stream role is `owner`. |

The local implementation uses the existing full `thread/turns/list` pagination
contract. It retains the legacy `thread/read(includeTurns:true)` fallback when
the server cannot serve that contract. The new Chinese occupancy notice and
manual reconnect button are a replica recovery presentation; their exact layout
has not been asserted as an original-app pixel match.

## Local state and mutation gate

`loadedThreadId` means the selected transcript and working-folder context were
read successfully. `resumedThreadId` is set only by a successful runtime resume
or successful local thread creation. A synchronous ref clears that writer gate
as soon as selection changes, a chat is removed, or the connection is lost.

The composer requires both IDs to match the selected chat, hydration to have
finished, and the working-folder context to match. It preserves a user's draft
when writer access is unavailable. Steering checks the writer again before
adding an optimistic follow-up; interrupt uses the same composer gate. Revert
checks writer access both in its UI and immediately before the mutation.
Opening a read-only transcript is still a successful navigation action, so
native open-thread requests can be acknowledged without claiming writer access.

Manual reconnect performs a fresh resume and history read. Until that actual
resume succeeds, the transcript remains a reader. Obsolete selection results
cannot install metadata, history, context, or writer access on a different route.

## Verification

```sh
npx vitest run src/renderer/src/threadContinuity.test.ts \
  src/renderer/src/threadHydration.test.ts
npm run typecheck:web
```

The 18 targeted tests cover descending page order, cursor continuity, both
writer-conflict responses, authoritative metadata, native and legacy reader
recovery, a later successful resume, failed reads, ordinary resume failures,
obsolete selection cancellation, mismatched thread responses, and composer and
revert gates. These tests use synthetic chat contents and do not mutate an
existing user's chat. Live replica acceptance is handled separately by the
main task. The final packaged native acceptance separately loaded the occupied
chat's real transcript, confirmed that the notice is above the composer and its
reconnect button is reachable, and verified that sending remains disabled.
