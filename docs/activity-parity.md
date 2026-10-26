# Conversation activity reconstruction

This pass directly inspected the installed `/Applications/ChatGPT.app/Contents/Resources/app.asar` from Codex **26.1016.62342 / 21477**, following REA's [artifact reconstruction](https://github.com/morluto/rea/blob/3e7e102a518b9112a2a8aa0590ae6f6951fd0635/docs/javascript-artifact-reconstruction.md) and [application workflow](https://github.com/morluto/rea/blob/3e7e102a518b9112a2a8aa0590ae6f6951fd0635/docs/javascript-application-workflows.md) approach. The source modules were extracted as data under ignored `reverse/raw/source/installed/webview/assets`; they were not executed. This uses the shipped implementation and translations, rather than a clean-room recreation.

The original application's Computer Use denial remains in effect. The user's supplied video was inspected offline with AVFoundation. No alternate control channel was used on the original application. This pass adds behavior to the editable renderer; it does not claim the editable renderer is identical to the original runtime.

## Exact artifact evidence

The offsets below are **zero-based UTF-8 byte offsets** in the named shipped files, not line numbers or offsets into the whole ASAR.

| Shipped module | SHA-256 | Anchors and offsets |
| --- | --- | --- |
| `app-initial-dddef47d6ef6.js` | `1fc7b685efab4be2d9656e02086180dd9e43dcac0fae1e2b1ec233447ed03843` | `SS` 2968926, `X6n` 3621237, `case subAgentActivity` 3631023, `case item/mcpToolCall/progress` 2539339 |
| `agent-activity-item-748850b17d3d.js` | `9b8c8ee3758b67c4814e7fed703c0f6068bc425e028a9e6bae17c48ba0fc471d` | `dr` 20260, `U` 11049 |
| `mcp-tool-activity-label-d12f11e2a426.js` | `239af3d181a212594e737ba5c31c8464530330f449a26313bf4c8fe98fbd294e` | `jt` 89090, `xa` 472665, `wa` 475535, `Na` 476865 |
| `mcp-tool-item-content-7a0c702df595.js` | `0629e48c43ac22fd01141c20105cfe33f94666fe4f57694a8b4ef70f2d8a4c6b` | `va` 28447, raw-output tooltip 37748, no-result message 44192 |
| `sites-end-resource-7244e15fbe89.js` | `1787883bbda7af923bd4621459d3af4266ac1073577e0339ab9d8e287230037c` | `BE` 252465, `tO` 293184, `lO` 294066, `wk` 361148, `Tk` 364339 |
| `local-conversation-turn-b121f8c96eae.js` | `f43d065afe64cd439f51950e2e114e4f3832dbcf77909b7c558b8eeb97da121d` | `Pc` 55694 |
| `local-conversation-subagents-panel-tab-9ef7c21f6fb1.js` | `d91379e4bf873d0949b1a2528ade1c239bf2de29fd692d10226051e42ef46366` | `F` 621, `B` 3940 |
| `subagent-panel-8283136e7f00.js` | `99ff9fbf2f1c554de60135006a29983d09ddf42dd90887a96e0ff001d05fbc44` | header `T` 3794 |
| `sites-end-resource-c24512139416.css` | `305190043d8059a7707414813159f6fb2fe04174c00e7827280b5de17c8d3a00` | avatar entrance rule 1101 |
| `zh-CN-8bcb976a6283.js` | `fedbd81fcf057bf1e4dca9a6086cf74ac6a460f2d16089aa508ce071bb4b347d` | `subagents.activity.summary` 2711421, raw-output heading 879731 |

These source facts informed the changes:

- `X6n/SS` distinguish MCP invocation parameters from output, retain text/image/audio/resource/resource-link output, and convert protocol and tool failures separately. `va` shows structured JSON, removes duplicated JSON text, exposes an empty-result state, and opens a raw-output dialog containing the call ID, invocation, duration, and result.
- `jt/xa/wa/Na` specialize Codex actions, select active/completed/failed text, use a supplied JavaScript `title` after whitespace normalization with an 80-character boundary, consult invocation metadata, strip matching connector prefixes, and use connector action registries or a readable fallback. Opposite boolean actions such as unarchive/unpin have their own descriptors.
- `tO/nO/rO/iO/lO` select a search query, URL, or find-in-page pattern; consolidate `site:` restrictions into a domain suffix; and show the first query plus ` ...` for multi-query search. Chinese search detail starts with `：`.
- `dr` omits empty searches. The dynamic renderer registry marks `update_up_next` as hidden. The source's `item/mcpToolCall/progress` branch explicitly logs **“Ignoring mcpToolCall progress message”**. Consequently this pass did not add a reducer branch that invents visible progress events.
- `BE/zE/VE` keep the latest activity per agent in each inline group. `Pc/wk/Tk` render up to four 16px avatars, all names for up to three agents, and the first two names plus overflow for larger groups. Named text opens the corresponding child conversation; unnamed overflow avatars are also navigable. Interrupted status wins over updated status, and all-completed groups become completed.
- The installed Chinese group sentence joins two names with `和`, three with `、` and `和`, and larger groups with `另外{hiddenCount}个子智能体`. The model tooltip says `使用 {model}`. The selected child transcript header has a back control, a 24px avatar, its name, and model/reasoning text.

## Retained labels and renderer behavior

[`toolActivityCatalog.ts`](../src/renderer/src/toolActivityCatalog.ts) retains **327 connector action pairs** from twelve source families and **96 Codex action descriptors**. The connector families are browser, Figma, GitHub, Gmail, Google Calendar, Google Drive, Linear, Notion, Sites, Slack, Vercel, and Wallet. The source descriptor IDs were paired with the shipped `zh-CN` values; only base active/completed connector messages and literal Codex state branches were retained. The catalog SHA-256 is `e79931fe7176b9d909f9c1c5be999b53b177d68ff33ea29268e3b2247c3d2df4`.

[`ToolActivity.tsx`](../src/renderer/src/ToolActivity.tsx) replaces the generic “used tool” row for MCP and dynamic calls with a collapsed disclosure, output families, error and no-output states, and raw JSON dialog. Web search has its own summary/detail line. Compaction shows manual/automatic/interrupted states and the source's ten-second delay notice. Protocol errors and reconnect messages are visible directly. The renderer CSP permits `data:`/`blob:` audio sources so MCP audio content can play.

[`SubagentActivity.tsx`](../src/renderer/src/SubagentActivity.tsx) exposes a conversation context for child navigation and groups adjacent agent events through [`ConversationActivity.tsx`](../src/renderer/src/ConversationActivity.tsx). Repeated updates for the same child no longer create duplicate names within that group. Receiver names also resolve from nested thread/source metadata. Existing source avatar assets are reused.

[`SubagentThreadPanel.tsx`](../src/renderer/src/SubagentThreadPanel.tsx) loads the requested child, displays loading/error/retry states, renders its complete transcript through the existing conversation renderer, and can open it as the main chat. The callback is independent of temporary side chat. [`readSubagentThread`](../src/renderer/src/subagentThreadModel.ts) uses `thread/read`; for paginated or metadata-only responses it reads every full turn page with repeated-cursor rejection. Reads do not select or resume either conversation. The app supplies current session turns and a child-specific context to keep nested navigation and model tooltips correct.

[`ActivityTooltip.tsx`](../src/renderer/src/ActivityTooltip.tsx) provides hover and keyboard tooltips for model text, overflowing prompts/search detail, raw output, and panel controls. These are implemented tooltip surfaces with CSS and a delay; their exact native animation and pointer geometry have not been measured in this pass.

## Video and verification

The supplied recording is the same resource identified by [`video-evidence-2026-10-23.json`](../reverse/video-evidence-2026-10-23.json). Five frames were extracted at 00:00, 05:05, 05:35, 06:10, and 06:41 into ignored `reverse/raw/activity-frames`. At **00:00**, a visible three-avatar row presents three child names with a combined “开始工作” status. At **05:35**, a collapsed completed command summary is followed by an active file-read row. These frames substantiate the grouped activity layout and live/completed hierarchy; they do not show the new MCP raw-output dialog or prove child-panel click parity.

Final focused verification passed:

- `npm run typecheck:web`.
- Six activity suites, **57 tests**, covering label precedence, connector resolution, boolean action labels, search detail conversion, result families, JSON de-duplication, failure output, raw payloads, background pagination, repeated cursors, model spelling, group boundaries, group deduplication, overflow limits, and navigation markup.
- A Vite server-rendered structural fixture in ignored `reverse/raw/activity-checks/static-render.html` contains the three-avatar group, search summary, MCP label, and five result families. Its SHA-256 is `20cb3c9acc35020881b5580aba80a1265879f517ab94cc47b90c0b9031336b0c`. Assertions passed without opening a browser or controlling the original app.

The focused tests and fixture establish model/markup behavior, not pixel or live interaction acceptance. Source-specific connector context/count variants, connector logos, embedded MCP Apps, the full active/done child-agent overview, and exact tooltip/transition geometry remain outside this pass. The current session was locked during final verification, so no live screenshot comparison was claimed. The main task's final packaging must use the source snapshot after the grouped-agent addition.
