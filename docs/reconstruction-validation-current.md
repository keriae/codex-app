# Current macOS reconstruction validation

The latest installed-version reconstruction is [Codex Study 2026-10-29](workbench-activity-parity-2026-10-29.md), based on **26.1023.50603 / 22391**. The native UI/model acceptance below belongs to the earlier build; the latest build has static and backend-handshake acceptance.

The separate editable client now has [2026-10-30 UI/native acceptance](ui-detail-parity-2026-10-30.md), including real clipboard copying, breadcrumb/compact-controls and full/split/zoom states, a readonly model fixture, and 1,422 passing tests with a rebuilt package. These results do not revalidate or replace the retained-runtime build described below.

On **2026-10-24**, the installed **26.1016.62342 / 21477** runtime was rebuilt into:

```text
$PWD/release/local-runtime/Codex Study Final.app
```

The final build completed at **15:24:42 Asia/Shanghai**. It retains the installed renderer, preload, business services, Owl framework and native implementations through the REA shipped-artifact reconstruction workflow. The builder isolates desktop state, initializes missing local Codex Work preferences, and preserves the original signatures of unmodified standalone child runtimes. See [startup source evidence](reconstruction-startup-routing.md).

## Build and static validation

```sh
npm run reconstruct:mac -- \
  --output "$PWD/release/local-runtime/Codex Study Final.app" \
  --profile "$HOME/.codex-re-profile/reconstruction-final-current"
codesign --verify --deep --strict "release/local-runtime/Codex Study Final.app"
```

The sibling `Codex Study Final.reconstruction/` directory contains the build report and full before/after disk and ASAR manifests. These are local ignored output, together with the application.

| Check | Final result |
| --- | --- |
| Original renderer files byte-identical | **20,364 / 20,364** |
| ASAR entries preserved | **21,725** |
| ASAR file hashes checked / unchanged | **21,346 / 21,336** |
| Modified ASAR files | Three isolation infrastructure modules and seven native signatures |
| Main/runtime native files / nested bundles locally signed | **39 / 14** |
| Standalone native files / nested bundles retaining original signatures | **50 / 15** |
| Preserved standalone helper trees completely byte-identical | Passed; any changed file aborts the build |
| Installed source disk unchanged after build | Passed, complete post-build manifest comparison |
| Original/output fuse positions equal | Passed, one v1 wire with nine positions |
| Embedded ASAR validation / ASAR-only loading | Both remain enabled |
| Header hash and sealed integrity dictionary | Updated and verified after final signing |
| Independent `codesign --verify --deep --strict` | Passed |

The source ASAR SHA-256 is `5b5cf52887cfd4de19cb5862155a8ef6cf58830c0a2fc592b72060cfcc3be869`.
The final output ASAR SHA-256 is `62dd2fbbb2ce6c544c69ab5cbcf0d3325b257726ee7a6bf4e21f223f01f9278d`.
Its header SHA-256 is `1e5138f830419894ca559a374fd7862be5551a3c99bc5538924bfc2566e60766`.

The native integrity slot at byte offset **267315760** retains `used=1` and `version=1`. The final dictionary digest is `921208dd26a5e7e489d2292ddc5ac009d8b8e455b0d1102e10914eefb490f358`. Only its digest fields changed before local signing. The builder recomputes the declarations for seven reviewed source unpacked-native contradictions.

Unmodified `cua_node`, `codex-cli`, plugin child runtimes and standalone helpers retain their complete source bytes, signatures and provisioning profiles. The copied Node executable independently reports the original OpenAI Developer ID and Team `2DC432GLL2`. No vendor signing key is recreated. The modified main application, frameworks and modules loaded by that runtime use local ad-hoc signatures and local development entitlements.

## Actual profile guard and backend verification

```sh
node scripts/reverse/verify-reconstruction-profile-guards.mjs \
  "release/local-runtime/Codex Study Final.app"
node scripts/reverse/verify-reconstruction-backend.mjs \
  "release/local-runtime/Codex Study Final.app"
```

**37 delivered-bootstrap cases passed.** The verifier extracts the actual isolation function from the delivered ASAR and runs it with a stub Electron path API and temporary filesystem fixtures. It checks independent and overridden roots, protected-path overlaps, symlink escapes, dangling paths, private modes, CLI routing, preserving existing local choices, startup idempotence, and rejecting malformed/non-file/aliased state or temporary write collisions.

The final independent desktop root is `$HOME/.codex-re-profile/reconstruction-final-current`. Owl's early native/browser root is independently validated at `$HOME/Library/Application Support/Codex Replica Local`. The wrapper restores the existing server home `$HOME/.codex`; no original desktop cookies, credentials or profile databases are copied.

The final wrapper passed `initialize`, `getAuthStatus`, `model/list` and `thread/list`, returning one model and one thread with zero pending approvals. It confirmed the initialized server home matches the existing server home. `authMethod` is null for this machine's backend configuration. The probe stops only its own temporary server process and does not submit turns.

The final app itself was launched by native Computer Use using its own absolute bundle path. Main PID **50834** recorded a successful local **stdio** handshake at **15:25:22**, **durationMs=257**. The independent log contains subsequent fixture activity. The original installed UI was not operated.

## Native window and interaction acceptance

After the user unlocked macOS, native acceptance first exercised the independently configured `Codex Study Ready.app`, then confirmed the final signature-preserving rebuild loads the same byte-identical Codex renderer. The initial `Codex Study Verified.app` had reached ChatGPT onboarding; that fresh-profile route was fixed through supported local atoms only.

| Native check | Observed result |
| --- | --- |
| Codex homepage | Mode selector says Codex; “我们要构建什么？” and the real model/permission composer load |
| Local server sidebar | Existing server chat list loads in the independent desktop state |
| Hide / show sidebar | Sidebar and composer layout change and restore correctly |
| `⌘N` | New unsent chat opens and composer receives focus |
| `⌘,` | Settings opens and its search field receives focus |
| Settings navigation | General, Appearance and Keyboard Shortcuts load the shipped controls |
| File / application menus | Native item structures were captured; Settings, New Chat and native menu names are present |
| Native window zoom / restore | Layout rendered at **4112×2410**, then restored to **2560×1640** |
| Final rebuilt homepage | Fresh final profile enters Codex directly without hosted onboarding submission |

The first native model fixture used a distinct projectless persisted test chat because the normal UI does not expose an ephemeral-thread option. It submitted only a fixed instruction to return `codex-replica-ok`, with no tool use or file access. The actual server transcript records:

- Thread `01a16cc3-f729-7372-b665-63f77ef1709c`.
- Turn `01a16cc4-56d2-7161-8232-148571dd69e9`.
- `gpt-6.1-sol`, effort `ultra`, source `Codex Desktop`, CLI `0.163.0-alpha.11.2`.
- Start **15:16:09**, completion **15:16:16**, **7,619 ms**.
- Actual assistant output **`codex-replica-ok`**, **zero tool calls**.

The UI displayed that answer, removed its processing state and restored the Send button. Its own desktop profile associates the fixture with the server transcript. The read-only verifier reproduces this evidence check:

```sh
node scripts/reverse/verify-reconstruction-turn.mjs \
  "release/local-runtime/Codex Study Ready.app" \
  01a16cc3-f729-7372-b665-63f77ef1709c
```

## Standard authorization boundary and unfinished acceptance

The final app's separate read-only tools fixture asked only for `list_artifacts` on that fixture's own chat. It did not inspect other chats, global projects or project files. Thread `01a16ccd-ff38-7142-9047-802e394575b9`, turn `01a16cce-4a41-78c3-b1b2-46758a20167b`, completed at **15:27:21** in **20,696 ms**. The model made three metadata-only `ALL_TOOLS` discovery calls, then explicitly reported that `list_artifacts` was unavailable. There was **no native app-tools call** and no file or chat tool call.

The final native log records `dynamic_app_tools_peer_rejected reason=missing-code-signing-identity` and `Codex app tools pipe closed`. Preserving child signatures removed the earlier child `teamNotFound` condition, but Computer Use now rejects the ad-hoc main caller with **“Sender process is not authenticated”**. The original packaged `authorizeSocketPeer` path remains unchanged; no development authorization mode or disabled check is used. This establishes an actual signing-identity boundary, not successful tool acceptance.

The server configuration also reports a missing executable for its `computer-use` MCP. Hosted durable connections require ChatGPT sign-in. These capabilities, vendor DeviceCheck/APNs/Keychain identity, and unexercised screens cannot be claimed as completely verified by retained renderer hashes or a successful model turn. The modified copy uses bundle identifier `com.openai.codex.replica.local`; its URL schemes are prefixed, and the installed original retains the original OS protocol handler.

Final reproducible raw checks are under ignored `reverse/raw/checks/`: `reconstruction-profile-guards-current.json`, `reconstruction-backend-current.json`, `reconstruction-turn-current.json` (the successful Ready fixture), and `reconstruction-tools-current.json` (the final standard-authorization failure). Native JPEG/AX evidence is in `reconstruction-native-current/` and `reconstruction-native-final/`. Screenshots remain local ignored files. The verification scripts and this document are retained project sources.
