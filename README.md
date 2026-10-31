<h1 align="center">codex-app for macOS</h1>

<p align="center">
  <strong>A Codex desktop workspace you can inspect and change.</strong><br />
  Follow the conversation, edit files, review changes, and keep terminals and browser tabs beside your work.<br />
  An independent macOS learning reconstruction, built with Electron, React and TypeScript, connected to the official Codex app-server.
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/actions/workflows/ci.yml"><img src="https://github.com/keriae/codex-app/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple&logoColor=white" alt="macOS 13 or newer" />
  <a href=".nvmrc"><img src="https://img.shields.io/badge/Node.js-24.11%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24.11 or newer" /></a>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a><br />
  <a href="#quick-start"><strong>Run it locally</strong></a> ·
  <a href="#capabilities">Explore the features</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="docs/README.md">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/raw/refs/heads/main/docs/media/codex-replica-promo.mp4">
    <img src="docs/media/codex-replica-promo.gif" alt="Running macOS client: send a prompt, follow agent activity, inspect the workspace, and review changes" width="960" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/raw/refs/heads/main/docs/media/codex-replica-promo.mp4"><strong>Watch / download the MP4 demo</strong></a> ·
  <a href="docs/media/codex-app-preview.png">Still image</a><br />
  Recorded from the running client with a fictional workspace and deterministic demo responses. <a href="docs/media/README.md">Demo notes</a>.
</p>

## Quick start

You need **macOS 13+**, **Node.js 24.11+**, and a configured [Codex CLI](https://github.com/openai/codex) or an existing Codex app-server. Install and configure Codex separately; this repository provides the desktop client.

```bash
git clone https://github.com/keriae/codex-app.git
cd codex-app
npm ci
npm run dev
```

Open a project directly:

```bash
npm run dev -- --cwd="/absolute/path/to/project"
```

By default, the client discovers the local Codex CLI and starts its own stdio app-server. Use `CODEX_BINARY=/absolute/path/to/codex` to select an executable.

<details>
<summary><strong>Use an app-server that is already running</strong></summary>

Replace the address with your server's actual WebSocket endpoint:

```bash
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 npm run dev
```

For a Unix listener that supports WebSocket upgrade, set `CODEX_APP_SERVER_SOCKET=/absolute/path/server.sock` instead. Configure one endpoint variable. A failed explicit connection is reported without starting another server. See [connection and protocol notes](docs/app-server-protocol.md).

</details>

<details>
<summary><strong>Build a local macOS app</strong></summary>

```bash
npm run package:mac
open release/mac-arm64/Codex.app
```

Apple Silicon is the documented package target. `npm run dist:mac` also creates local DMG and ZIP artifacts. See [build and validation notes](docs/source-validation-current.md).

</details>

## Capabilities

| Workflow | What is available |
| --- | --- |
| Follow the agent | Streaming replies, command output, tool activity, approvals, steering, interruption, and subagent transcripts |
| Work on files | Project file tree, CodeMirror source editing, Markdown preview, autosave, file watches, and conflict recovery |
| Review changes | Unified, split and Auto diff layouts, word highlights, local inline comments, and file or selection context in the composer |
| Keep tools nearby | Dockable terminal and browser tabs, retained local terminal sessions, page find, and zoom |
| Organize projects | Project search and pins, chat history, rename, archive/restore, thread forks, and local Git worktree creation |
| Inspect integrations | Plugin, skill and MCP inventories, supported backend operations, and collaboration activity |
| Use the desktop | Native menus and shortcuts, clipboard images, file dialogs, notifications, and multiple windows |

The interface and desktop services are editable in this repository. Models, agent tools, authentication and thread storage come from the [official Codex app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server):

```text
React / TypeScript UI → isolated Electron IPC → Codex app-server
```

## Current limits

Functional and visual parity are still in progress. This is a learning and experimentation project, not a claim of complete equivalence to the reference application.

- **macOS is the target.** Windows and Linux are outside the current scope.
- **Some workflows are incomplete.** Remote/cloud integration, MCP Apps, voice/realtime, full Git review sources and revision-backed previews still have gaps.
- **Validation is scoped.** Passing tests or demonstrating one workflow does not establish every interaction, failure mode or pixel match.

The [feature inventory](docs/feature-inventory.md) describes coverage; [current validation](docs/source-validation-current.md) records checks and remaining boundaries. The demo shows UI behavior with fixture responses, rather than measuring model performance.

## FAQ

<details>
<summary><strong>Where do the models and agent tools come from?</strong></summary>

From your configured Codex CLI or app-server. Model access, account state and server configuration follow that installation. The desktop client does not include a replacement model or agent server.

</details>

<details>
<summary><strong>Do I need the reference desktop app installed?</strong></summary>

The editable client needs a configured Codex CLI or app-server. The separate, optional local runtime study workflow requires the reference application to be installed. See [the reconstruction workflow](docs/reverse-engineering.md).

</details>

<details>
<summary><strong>How is the reconstruction studied?</strong></summary>

The project follows [REA](https://github.com/morluto/rea)-inspired direct source and asset inspection, recorded interactions, geometry measurement, protocol traces and runtime checks. Start with the [method and evidence index](docs/README.md#reconstruction-and-evidence), `src/renderer` for the UI, or `src/main` for desktop services.

</details>

<details>
<summary><strong>Why did it open the wrong workspace or server?</strong></summary>

Check your login shell for conflicting `CODEX_WORKSPACE`, `CODEX_BINARY`, `CODEX_APP_SERVER_URL` or `CODEX_APP_SERVER_SOCKET` exports. Shell environment hydration can override inline development settings. An external app-server uses its own configuration and credentials. See [connection notes](docs/app-server-protocol.md).

</details>

## Help improve it

A useful contribution can be one interaction: reproduce a UI mismatch, improve a menu or tooltip, clarify a setup step, or add a focused protocol test.

- [Report a bug](https://github.com/keriae/codex-app/issues/new?template=bug_report.yml) with reproduction steps.
- [Report a UI mismatch](https://github.com/keriae/codex-app/issues/new?template=ui_mismatch.yml) with versions, display settings and a public reproduction.
- [Suggest a missing feature or interaction](https://github.com/keriae/codex-app/issues/new?template=feature_request.yml).
- Read the [contributor guide](CONTRIBUTING.md) for setup, verification and public-source requirements.

Current priorities include conversation and workbench fidelity, review workflows, reconnect behavior, and visual coverage across themes and window sizes.

If this project is useful for your learning or experiments, **star the repository** to help other macOS developers discover it.

## Project status

Independent project, unaffiliated with OpenAI. The repository is **source-available for study** and currently has no standalone open-source license. Original runtime study bundles and private captures stay local. [Resource notes](resources/README.md) and [media notes](docs/media/README.md) describe provenance. Codex, ChatGPT, OpenAI and related marks belong to their respective owners.
