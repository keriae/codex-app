# App-server listener attachment and recovery

This implementation was checked directly against the installed macOS desktop
package on 2026-10-24 (Asia/Shanghai), version `26.1016.62342`, build `21477`.
It retains the recorded desktop initialization payload in `desktopProtocol.ts`
and does not send the generic `initialized` notification. Transport behavior
was recovered from shipped code and verified against the companion CLI
`0.163.0-alpha.11.2`.

## Shipped-code evidence

The inspected archive is `/Applications/ChatGPT.app/Contents/Resources/app.asar`.
Extracted source remains in ignored `reverse/raw/source/installed/`.

| Module | SHA-256 | Relevant recovered behavior |
| --- | --- | --- |
| `.vite/build/src-CsH31EEu.js` | `6a266611954c6f0c72aca09bb13c0c793959a69e8d6330778a7cdef21835a1db` | `yV.scheduleReconnect`, character offset 1287702: one reconnect timer, transport eligibility and quitting guards, exponential delays; `uV=1000`, `Lz=20000`; fresh initialization generations. `XL` / `ZL`: a queued request is `not-sent`; a dispatched request without acknowledgment is `outcome-unknown`. |
| `.vite/build/application-network-startup-BG13czUt.js` | `90db83017c05bf247b53a09bb04a3312e0003259c56144535b09805085b16a6c` | `Ks`: ordinary local stdio is the default; local daemon reuse selects WebSocket over `app-server-control.sock`; `supportsReconnect()` tests whether its current kind is `websocket`. |
| `.vite/build/main-JI9qDiXp.js` | `b8c5d07cc3c30fbf0abe729b05434e7d1ffa19ee6c4daa818ae8f855be66d1e1` | Unix/SSH WebSocket handshake URL and the `x-codex-websocket-max-unfragmented-message-bytes` header; the 16 MiB default. Some wrapper transports opt into reconnection independently of the low-level stdio implementation. |

The existing [protocol notes](app-server-protocol.md) and
[public app-server protocol](https://learn.chatgpt.com/docs/app-server#protocol)
provide message framing and correlation context. This document records the
additional replica listener configuration and its current recovery behavior.

## Connect an already running server

Explicit endpoint settings have precedence over daemon discovery and private
stdio startup. A failed explicit endpoint is surfaced as a connection error;
the client never silently spawns a replacement server. Configure one variable:

| Configuration | Meaning |
| --- | --- |
| `CODEX_APP_SERVER_URL=ws://127.0.0.1:4500` | Public local WebSocket listener; the supplied path is retained. |
| `CODEX_APP_SERVER_URL=localhost:4500/rpc` | Loopback shorthand for a WebSocket endpoint. IPv6 `[::1]:4500` is also accepted. |
| `CODEX_APP_SERVER_URL=wss://localhost:4500/rpc` | TLS WebSocket using normal certificate validation. |
| `CODEX_APP_SERVER_SOCKET=/absolute/path/server.sock` | WebSocket upgrade over a Unix-domain socket. Relative paths resolve from the launch cwd. |
| `CODEX_APP_SERVER_URL=unix:///absolute/path/server.sock` | Equivalent Unix endpoint; `ws+unix:///...` and absolute path values are also accepted. |

For example, if the existing server is listening on port 4500:

```sh
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 npm run dev
```

The current companion CLI advertises `--listen stdio://`, `unix://PATH`,
`ws://IP:PORT`, and `off`. A private stdio process already attached to another
desktop client exposes no independent connection endpoint. A separate client
must use an existing WebSocket/Unix listener; it cannot attach to another
client's stdin/stdout session.

Without either explicit endpoint, the replica keeps its normal private stdio
startup. `CODEX_APP_USE_MANAGED_DAEMON=1` retains optional private-socket
discovery and initial fallback to stdio. Once a daemon connection succeeds,
recovery retains that same stable socket path. It never switches a running
chat to a private process after an unexpected disconnect. Closing the replica
closes only its client socket; a shared server remains running.

## Recovery contract

WebSocket and Unix-socket sessions reconnect automatically with delays of
1, 2, 4, 8, 16, then 20 seconds. A successful initialization resets the delay.
Private stdio recovery remains manual by default, matching the ordinary local
transport. Callers may explicitly set `autoReconnect: true` to opt in.

`AppServerClientOptions` also accepts `autoReconnect: false`,
`reconnectInitialDelayMs`, `reconnectMaxDelayMs`, and `reconnectMaxAttempts`.
The default retry count is unlimited for an eligible socket. Authentication
and unsupported-initialization RPC errors (401, 403, -32601, -32602) stop
automatic retries. Reconnection is transport recovery, so it does not repeat
a server-overload RPC or replay a request with an uncertain outcome.

On disconnect, all client promises and active writes settle, server approval
requests are cleared, and stale generation responses are ignored. Recovery
sends a new desktop `initialize` and authentication check. The renderer's
existing connection transition handling reads the selected thread again.
Unconfirmed mutation RPCs are never resubmitted by the transport.

`AppServerDeliveryError` exposes `method`, `stage`, and structured `data`.
Its message includes `[not-sent]` or `[outcome-unknown]` so delivery status
survives Electron IPC's standard error serialization. `not-sent` means the
request had not reached the transport. `outcome-unknown` means a write was
attempted and its server acknowledgment was lost or timed out. The latter
requires reconciliation before a user action repeats a mutation. RPC error
responses remain `AppServerError` with the server's code and data.

Ordinary response deadlines remain 45 seconds; standalone PTY command exit
responses remain unbounded. Every transport write has a separate finite
deadline (default 45 seconds). Pending request counts, approval counts,
outgoing queue counts, incoming payloads, and negotiated outbound frame sizes
are bounded. App stop cancels both a pending HTTP upgrade and a scheduled
reconnect, including callers waiting on that reconnect. A
`serverRequest/resolved` notification removes the matching approval from the
main-process map before forwarding it, preventing a later duplicate answer.

## Verification

```sh
npx vitest run src/main/appServer.test.ts src/main/managedDaemon.test.ts \
  src/main/serverEndpoint.test.ts src/main/appServerTransport.test.ts
npm run typecheck:node
node scripts/verify-app-server-transport.mjs
```

The transport suite passes 52 tests, including actual HTTP WebSocket and Unix
WebSocket fixtures, dropped-mutation acknowledgments, fresh-session recovery,
backpressure, resolved approvals, canceled handshakes, stalled writes, retry
ceilings, and canceled reconnect waiters.

The installed-CLI smoke opens two temporary listeners owned by the script,
uses read-only `model/list` and `thread/list`, closes the client, and connects
a second session to each same server. Both actual listener transports reported
`ready`, one model and one thread, and a successful second session while their
server stayed running. The script stops only its own temporary processes and
prints counts rather than account or conversation data. Existing stdio server
processes on this machine have no attachable listener, so this verification
does not claim to attach to their already established sessions.
