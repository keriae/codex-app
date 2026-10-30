<h1 align="center">codex-app for macOS</h1>

<p align="center">
  <strong>把 Codex 桌面体验变成你能修改的代码。</strong><br />
  流式对话、文件编辑、Diff、终端和 Agent 过程展示。<br />
  使用 Electron、React 和 TypeScript，连接现有 Codex app-server。
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/actions/workflows/ci.yml"><img src="https://github.com/keriae/codex-app/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple&logoColor=white" alt="macOS 13 及以上" />
  <a href=".nvmrc"><img src="https://img.shields.io/badge/Node.js-24.11%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24.11 及以上" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文<br />
  <a href="#快速开始"><strong>快速开始</strong></a> ·
  <a href="#功能概览">功能概览</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <a href="docs/media/codex-replica-promo.mp4">
    <img src="docs/media/codex-app-preview.png" alt="可编辑的 macOS 客户端：对话、项目侧栏、工作区摘要和输入框" width="960" />
  </a>
</p>

<p align="center">
  <a href="docs/media/codex-replica-promo.mp4"><strong>▶ 观看 15 秒演示</strong></a><br />
  画面录制自实际运行的客户端，使用虚构工作区和确定性演示数据。
</p>

## 值得尝试的地方

- **看清 Agent 正在做什么。** 展开流式回复、命令输出、审批和子 Agent 对话记录。
- **在对话旁边处理项目。** 编辑代码和 Markdown，查看 Diff，使用可停靠的终端和浏览器标签。
- **自己改动桌面体验。** 修改 React 界面、研究 IPC 与协议，或连接现有 app-server 做实验。

这是一个用于学习和实验的独立 macOS 客户端复刻项目。功能与视觉一致性仍在完善，[功能清单](docs/feature-inventory.md)记录了已实现能力和剩余差异。

## 快速开始

需要 **macOS 13+**、**Node.js 24.11+**（见 [`.nvmrc`](.nvmrc)），以及已经配置好的 [Codex CLI](https://github.com/openai/codex) 或正在监听的 Codex app-server。`npm ci` 只安装客户端依赖；Codex 需要单独安装和配置。

```bash
git clone https://github.com/keriae/codex-app.git
cd codex-app
npm ci
npm run dev
```

打开自己的项目：

```bash
npm run dev -- --cwd="/absolute/path/to/project"
```

默认会发现本机 Codex CLI，并启动独立的 stdio app-server。需要指定可执行文件时，设置 `CODEX_BINARY`。

<details>
<summary><strong>连接已经运行的 app-server</strong></summary>

把示例地址替换成服务器实际的 WebSocket 地址：

```bash
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 npm run dev
```

如果使用支持 WebSocket upgrade 的 Unix 监听器，改为设置 `CODEX_APP_SERVER_SOCKET=/absolute/path/server.sock`。两种地址变量只配置一个；显式地址连接失败时会报错，不会另启服务器。详见[协议与连接说明](docs/app-server-protocol.md)。

</details>

<details>
<summary><strong>打包本地 macOS 应用</strong></summary>

```bash
npm run package:mac
open release/mac-arm64/Codex.app
```

文档中的打包目标是 Apple Silicon。`npm run dist:mac` 会生成本地 DMG 和 ZIP。开发版与打包版使用独立的桌面设置目录。构建及包验证见[源码验证记录](docs/source-validation-current.md)。

</details>

<details>
<summary><strong>启动后工作区或服务器不符合预期？</strong></summary>

检查登录 Shell 配置中是否导出了 `CODEX_WORKSPACE`、`CODEX_BINARY`、`CODEX_APP_SERVER_URL` 或 `CODEX_APP_SERVER_SOCKET`。启动时的 Shell 环境加载可能覆盖命令中的临时设置；移除冲突的导出后再启动。已经运行的外部服务器使用自身的配置与凭据。

</details>

## 功能概览

| 场景 | 可以体验的能力 |
| --- | --- |
| 对话 | 流式输出、追加指令、中断、审批、目标、富文本和工具输出 |
| 工作区 | 文件树、CodeMirror 编辑、Markdown 预览、自动保存、文件监听与冲突恢复 |
| 审查 | Unified Diff、本地行内评论、文件引用、选中文本加入输入框 |
| 右侧工作台 | 可停靠终端和浏览器标签、保留本地 PTY、页面查找与缩放 |
| 项目 | 项目搜索、置顶、聊天归档与恢复、对话分叉、私有 Git worktree 创建 |
| Agent 与集成 | 子 Agent 记录、协作过程、插件、Skill 和 MCP 清单 |
| macOS | 原生菜单、快捷键、剪贴板图片、文件对话框、通知与多窗口 |

远程与云端流程、MCP Apps、语音和完整平台集成仍未完成。依赖特定功能前，请查看[覆盖范围与验证边界](docs/feature-inventory.md#validation-boundary)。

## 实现方式

```text
React / TypeScript 界面 → 隔离的 Electron IPC → 现有 Codex app-server
```

客户端实现桌面界面和工作区；[Codex app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server)负责模型、工具与对话。渲染进程没有 Node.js 权限，主进程验证 IPC 来源并限制可调用的 RPC 方法。

方法参考 [REA](https://github.com/morluto/rea)，结合直接源码与资源检查、录屏交互、尺寸测量、协议记录和原生运行验证。详见[方法与证据入口](docs/README.md#reconstruction-and-evidence)。修改界面可从 `src/renderer` 开始，桌面服务在 `src/main`。

<details>
<summary><strong>在本机研究已安装的原始 renderer/runtime</strong></summary>

项目另提供保留已安装 renderer/runtime 的本地研究构建，并隔离桌面配置和服务器路由：

```bash
npm run reconstruct:mac -- --output "$PWD/release/local-runtime/Codex Study.app"
open "release/local-runtime/Codex Study.app"
```

需要先安装参考应用。生成的研究包留在本机，并被 Git 忽略。版本要求、选项和限制见[反向工程流程](docs/reverse-engineering.md)。

</details>

## 一起完善

不必一次实现大功能：复现一个 UI 差异、完善一处交互、补充连接文档或增加一个协议测试，都能帮助项目进步。

- [反馈 Bug 或 UI 差异](https://github.com/keriae/codex-app/issues/new?template=bug_report.yml)。
- [提出功能或交互需求](https://github.com/keriae/codex-app/issues/new?template=feature_request.yml)。
- [贡献指南](CONTRIBUTING.md)说明了开发环境、验证方式和公开材料要求。

目前重点是工作区与审查体验、重连与多窗口行为，以及不同主题、缩放和窗口尺寸的视觉覆盖。详细进度见[文档索引](docs/README.md)。

如果这个项目对你的学习或开发有帮助，欢迎点一个 **Star**，让更多 macOS 开发者发现它。

## 项目状态

本项目独立开发，与 OpenAI 无隶属或背书关系。目前源码公开供学习，尚未提供独立的开源许可证。原始 runtime 研究包和私有录制材料只在本地生成。资源与应用图标来源见 [resources](resources/README.md)，演示来源见[媒体说明](docs/media/README.md)。Codex、ChatGPT、OpenAI 及相关标识属于各自权利人。
