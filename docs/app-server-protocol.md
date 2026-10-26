# Codex app-server protocol notes

This document records the sanitized protocol behavior validated against the
macOS desktop target. It is an implementation guide, not a copy of the
upstream application or its source code.

## Captured protocol baseline and current runtime

The original initialization payload and transport observations below were
captured against:

- Desktop application version `26.1016.61520` (build `21421`).
- Bundled app-server version `0.163.0-alpha.11.1`.
- Managed app-server daemon version `0.163.0`.
- macOS on arm64.

On 2026-10-24 the installed `/Applications/ChatGPT.app` is version
`26.1016.62342` (build `21477`), with companion CLI
`0.163.0-alpha.11.2`. These current versions must not be substituted into the
historical payload or source offsets without a new capture. The editable
replica's configuration and PTY runtime probes used the current companion CLI;
the earlier managed-daemon observations retain the separate `0.163.0`
baseline.

The public protocol documentation is available at
<https://learn.chatgpt.com/docs/app-server>. The installed desktop client has
one initialization difference from the documented generic client flow, called
out below.

The wire format is JSON-RPC-like, but messages omit the
`"jsonrpc": "2.0"` member. Request and response correlation still uses `id`.

## Desktop initialization

For the main local app-server connection, the target build sends an
`initialize` request with the following shape. The optional top-level `trace`
member is omitted from this example because it is present only when a trace
context is active.

```json
{
  "id": "__codex_initialize__",
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "Codex Desktop",
      "title": "Codex Desktop",
      "version": "26.1016.61520"
    },
    "capabilities": {
      "explicitGatewayOauth": true,
      "experimentalApi": true,
      "extensions": {
        "io.modelcontextprotocol/ui": {
          "mimeTypes": [
            "text/html;profile=mcp-app",
            "text/html+skybridge"
          ]
        },
        "openai/elicitation": {
          "form": {}
        }
      },
      "mcpServerOpenaiFormElicitation": true,
      "requestAttestation": true,
      "optOutNotificationMethods": [
        "thread/readState/changed",
        "thread/project/updated",
        "thread/prediction/updated",
        "rawResponseItem/completed",
        "command/exec/outputDelta",
        "project/changed",
        "externalAgentConfig/import/progress",
        "thread/compacted",
        "windows/worldWritableWarning",
        "modelProvider/authRecoveryStarted",
        "modelProvider/authRecoveryCompleted",
        "authStatusChange",
        "loginChatGptComplete",
        "codex/event/task_started",
        "codex/event/agent_reasoning",
        "codex/event/agent_message",
        "codex/event/task_complete",
        "codex/event/mcp_tool_call_begin",
        "codex/event/mcp_tool_call_end",
        "codex/event/exec_command_begin",
        "codex/event/exec_command_end",
        "codex/event/exec_command_output_delta",
        "codex/event/exec_approval_request",
        "codex/event/apply_patch_approval_request",
        "codex/event/background_event",
        "codex/event/turn_diff",
        "codex/event/get_history_entry_response",
        "codex/event/agent_reasoning_delta",
        "codex/event/agent_reasoning_section_break",
        "codex/event/agent_message_delta",
        "codex/event/stream_error",
        "codex/event/error",
        "codex/event/turn_aborted",
        "codex/event/plan_delta",
        "codex/event/plan_update",
        "codex/event/patch_apply_begin",
        "codex/event/patch_apply_end",
        "codex/event/item_started",
        "codex/event/item_completed",
        "codex/event/user_message",
        "codex/event/agent_reasoning_raw_content",
        "codex/event/agent_reasoning_raw_content_delta",
        "codex/event/web_search_begin",
        "codex/event/web_search_end",
        "codex/event/mcp_list_tools_response",
        "codex/event/list_skills_response",
        "codex/event/list_remote_skills_response",
        "codex/event/remote_skill_downloaded",
        "codex/event/list_custom_prompts_response",
        "codex/event/raw_response_item",
        "codex/event/agent_message_content_delta",
        "codex/event/reasoning_content_delta",
        "codex/event/reasoning_raw_content_delta",
        "codex/event/warning",
        "codex/event/undo_started",
        "codex/event/undo_completed",
        "codex/event/shutdown_complete",
        "codex/event/entered_review_mode",
        "codex/event/exited_review_mode",
        "codex/event/view_image_tool_call",
        "codex/event/mcp_startup_update",
        "codex/event/mcp_startup_complete",
        "codex/event/remote_task_created",
        "codex/event/thread_rolled_back",
        "codex/event/thread_name_updated",
        "codex/event/elicitation_request",
        "codex/event/dynamic_tool_call_request",
        "codex/event/request_user_input",
        "codex/event/terminal_interaction",
        "codex/event/token_count",
        "codex/event/deprecation_notice",
        "thread/closed",
        "thread/reverted",
        "rawResponse/completed",
        "warning",
        "turn/diff/updated"
      ]
    }
  }
}
```

There are exactly 76 entries in `optOutNotificationMethods` for this target.
The list suppresses legacy or unused notifications while retaining the modern
thread, turn, item, approval, and tool-call protocol surfaces used by the
desktop client.

The editable macOS replica currently sends **75** opt-outs. It retains
`command/exec/outputDelta` because remote interactive terminals consume their
host app-server's standalone PTY stream. Local terminals use the installed
desktop's native `node-pty` dependency instead. The other recorded opt-outs
retain their order and contents. This deliberate remote transport adaptation
is covered by `desktopProtocol.test.ts` and does not change the original
captured 76-entry payload above.

The replica exposes terminal open/input/resize/close through dedicated native
bridge methods. For local projects, main uses the same `node-pty` dependency as
the installed desktop and fixes the shell argv to `/bin/zsh -l`. This keeps the
interactive shell outside app-server's command sandbox, so ordinary user state
such as `.zsh_history` and language-tool configuration remains writable. Remote
projects retain the host app-server PTY transport with `/bin/sh -l`. Main owns
the connection-scoped process ID and validates a previously selected cwd. The
generic renderer RPC bridge does not allow arbitrary `command/exec`.
Input/output use the protocol's base64 byte fields, with incremental UTF-8
decoding per output stream.

Every replica PTY request sets `TERM` to `xterm-256color` and sends `null`
overrides for `TERMINFO` and `TERMINFO_DIRS` to remove inherited terminfo paths.
This prevents a Finder/login environment such as `TERM=dumb` from changing the
interactive shell's terminal capabilities. The installed-CLI smoke scripts exercise the real PTY transport; implementation coverage and limits are in the [feature inventory](feature-inventory.md).

For remote terminals, the final `command/exec` response arrives when its process
exits, after that process's output notifications. Only this internal
standalone-command request has no client response timeout; the process also receives
`disableTimeout: true`. Ordinary RPC requests still time out after 45 seconds.
Terminal write, resize and terminate remain ordinary correlated RPC calls.
Closing a renderer document or quitting the app releases its terminal
sessions, including cancellation before a delayed backend startup can submit
a shell. See the [feature inventory](feature-inventory.md) for implementation scope and runtime limitations.

`clientInfo.name` is deliberately `Codex Desktop`. The string
`codex_desktop` is the desktop service name and IPC namespace; it is also used
by a separate startup probe. Substituting it for the main connection name
changes the app-server user-agent identity.

The `io.modelcontextprotocol/ui` extension is feature-sensitive. If DIL support
is enabled at runtime, append this MIME type:

```text
text/x-dil;profile=mcp-app
```

On macOS, the target advertises `requestAttestation: true` and must therefore
be prepared to answer `attestation/generate` server requests.

The successful initialization response has this shape:

```json
{
  "id": "__codex_initialize__",
  "result": {
    "userAgent": "<server-generated user agent>",
    "codexHome": "<absolute Codex home path>",
    "platformFamily": "unix",
    "platformOs": "macos"
  }
}
```

Do not persist or display `codexHome` without considering local-path privacy.

## The desktop main connection does not send `initialized`

The public app-server documentation describes the generic sequence as:

1. Send `initialize`.
2. Receive the initialization response.
3. Send the `initialized` notification.

The validated desktop main connection for version `26.1016.61520` omits step
3. After receiving the response, it records the returned platform information,
marks the connection initialized, and starts its authentication check.

This was also verified behaviorally against both the bundled app-server and
the managed daemon: each accepted the next request without an `initialized`
notification.

For an exact target-build reproduction, omit `initialized` on the main
connection. A reusable client library may expose an option to send it for
compatibility with other app-server versions. Do not confuse the main
connection with independent startup-probe or sandbox connections, which may
send `initialized`.

## Initial request sequence

The deterministic part of startup is:

1. Open the selected transport.
2. Send the `initialize` request above.
3. Wait for the matching response.
4. Without sending `initialized`, send the authentication-status request:

```json
{
  "id": "desktop-auth:<unique-id>",
  "method": "getAuthStatus",
  "params": {
    "includeToken": false,
    "refreshToken": false
  }
}
```

5. Enter the connected state when the response indicates that authentication
   is available or not required. Otherwise expose a sign-in-required state.

The renderer and background services then issue requests according to the
visible surface. Common early requests include:

- `account/read` with `{ "refreshToken": false }`.
- `model/list`.
- `config/read` with the active workspace path and layer preference.
- `thread/list`, usually newest-first and paginated.
- `permissionProfile/list`, `skills/list`, `plugin/list`, and `app/list` when
  their corresponding surfaces initialize.

These requests may run concurrently, so their observed wire order must not be
used as an application-state invariant. Correlate every response by `id`.

In the editable client, a Finder launch with an implicit `/` first uses the
home directory and can restore its saved catalog project. Explicit argument,
environment or non-root process cwd remains authoritative. Catalog/model
bootstrap is separate from `permissionProfile/list` for the current cwd;
stale directory or document responses cannot replace a newer navigation or
submission. These are source startup-state behaviors, not a new capture of the
historical target's request ordering.

The primary conversation flow is:

1. `thread/start` or `thread/resume`.
2. `turn/start`.
3. Consume `turn/started`, `item/started`, streaming item delta notifications,
   and `item/completed`.
4. Consume `turn/completed` and reconcile the final thread snapshot.

## Local diff comments in turn input

Local user diff comments are client-side attachments. Saving, editing or
removing one does not call a comment RPC or start a model turn. An explicit
send formats them into the existing text input, alongside ordinary text,
localImage and mention input items, then uses `turn/start` or `turn/steer`.
The recovered local format is:

````text
## User Comment 1
File: src/example.ts
Workspace: /absolute/workspace
Side: L-R
Lines: L259-R260
Diff hunk:
```diff
@@ -259,2 +259,2 @@
-old
+new
 context
```
Comment:
Please review both sides.
````

Workspace and diff hunk are optional. Same-side ranges use `Side: L` or `R`
and numeric `Lines`; mixed-side ranges retain the side on each endpoint.
The serializer preserves the actual patch hunk captured with the selection.

An independent draft scope migrates to the thread returned by `thread/start`.
After acknowledgement, submitted immutable attachment object identities and
explicit equivalent migration aliases are consumed, retaining waiting edits,
equal-content additions or recreated objects. Definite failures retain the
original scope; unknown steer outcomes reconcile against the original client
message before permitting a resend. These input and asynchronous lifecycle
behaviors are covered by App-handler tests. Native editable-client checks covered the comment editor, mixed-range visible/accessibility labels and composer chips without sending a model turn. Server acceptance of comment-only input and full visual parity remain separate acceptance work.

## Stdio transport

The desktop target launches its bundled CLI with the equivalent of:

```bash
/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex \
  -c features.code_mode_host=true \
  app-server \
  --analytics-default-enabled \
  -c plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true \
  -c plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=true
```

The exact bundle path should be discovered from application resources rather
than hard-coded in reusable code.

Stdio framing is newline-delimited JSON:

- Write one complete JSON message followed by `\n` to stdin.
- Read one complete JSON message per line from stdout.
- Treat stderr as diagnostics only; never parse it as protocol traffic.
- Apply output size limits and incremental line parsing so a large event does
  not force unbounded buffering.
- Reject malformed lines without losing synchronization with subsequent lines.
- On process exit, reject outstanding requests and transition all active turns
  out of their pending state.

The desktop process does not connect to a TCP listener for its primary local
session. Spawning app-server and using stdio is therefore the closest match to
the target application.

## Managed daemon over Unix WebSocket

The managed daemon listens through:

```text
~/.codex/app-server-control/app-server-control.sock
```

The stable path is a symlink to an ephemeral Unix-domain socket. Connect to the
stable symlink and never persist its current target. The socket is intended to
be private to the user and is created with mode `0600`.

The replica uses this transport only when
`CODEX_APP_USE_MANAGED_DAEMON=1` is explicitly set and the stable socket is
owned by the current user with private parent/socket modes. A connect or
initialization failure closes only the attempted client connection and falls
back to stdio. Once a daemon session is ready, an unexpected close is reported
as a connection error rather than silently moving an in-flight chat to a
different backend.

This transport is a standard WebSocket carried over a Unix-domain socket, not
raw JSONL. A client must:

1. Open the Unix socket.
2. Send an HTTP WebSocket Upgrade request.
3. Validate the `101 Switching Protocols` response and
   `Sec-WebSocket-Accept`.
4. Send masked client text frames containing protocol JSON.
5. Handle continuation, ping, pong, close, and server text frames according to
   RFC 6455.

The validated server advertised:

```text
x-codex-websocket-max-unfragmented-message-bytes: 16777216
```

Use the advertised value when present. Do not assume that every app-server
version uses the same limit.

The daemon may not be the same version as the application-bundled server.
Feature negotiation and generated schemas should therefore be associated with
the selected executable or daemon version.

## `app-server proxy` is a byte tunnel

`codex app-server proxy` forwards bytes between its stdin/stdout and the
managed daemon socket. It does not translate newline-delimited JSON into
WebSocket frames.

Consequently, writing an `initialize` JSON line directly to the proxy does not
perform a valid initialization. The tunneled bytes must still contain the HTTP
Upgrade handshake followed by properly encoded WebSocket frames. Treat proxy
mode as WebSocket-over-a-byte-stream, not as stdio app-server mode.

## Server-initiated requests

App-server can send requests to the client. They have both `method` and `id`,
and the client must return either `{ "id": ..., "result": ... }` or
`{ "id": ..., "error": ... }`. Ignoring a request can leave a turn blocked
indefinitely.

The target protocol groups server requests as follows.

### Approval requests

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `execCommandApproval` (legacy)
- `applyPatchApproval` (legacy)

The UI must present the requested action and scope, preserve the request ID,
and return an explicit decision. Closing a prompt is not equivalent to silently
dropping the request.

### User and MCP elicitation

- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`

These requests can require structured answers rather than a Boolean approval.
Validate the submitted value against the request schema before replying.

### Dynamic tool execution

- `item/tool/call`

Dispatch only to tools registered for the active client surface. Unknown tools
must receive a structured error response rather than remaining pending.

### Authentication and attestation

- `account/chatgptAuthTokens/refresh`
- `attestation/generate`

Token material and attestation inputs are sensitive. Keep them out of logs,
analytics, renderer snapshots, and persisted debugging artifacts.

The server can emit `serverRequest/resolved` when a pending request is resolved
elsewhere. The client should then dismiss any matching local prompt without
sending a second answer.

## Reliability requirements

- Maintain separate maps for client requests and server-initiated requests.
- Accept string and numeric request IDs.
- Time out requests explicitly and surface unknown outcomes after dispatch.
- Treat error code `-32001` with message `Server overloaded; retry later.` as
  backpressure, not a protocol parse failure.
- Bound outgoing queues and streaming buffers.
- Preserve notification order within one connection.
- On reconnect, initialize a fresh protocol session and reconcile threads from
  server state instead of replaying unconfirmed mutations blindly.
- Redact auth tokens, reasoning content, prompts, local paths, and environment
  data from logs.

## Schema generation

Generate types from the exact app-server executable being used:

```bash
codex app-server generate-ts --out /tmp/codex-app-server-types
codex app-server generate-json-schema --out /tmp/codex-app-server-schema
```

Generated output is version-specific. It should be reviewed for compatibility
and used to build local adapters; it should not be assumed to match a different
bundled or daemon release.
