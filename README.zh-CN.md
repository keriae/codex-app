<h1 align="center">codex-app for macOS</h1>

<p align="center">
  <strong>把 Codex 桌面工作区变成你能研究和修改的代码。</strong><br />
  跟进对话、编辑文件、审查变更，把终端和浏览器放在工作旁边。<br />
  独立的 macOS 学习复刻项目，使用 Electron、React 和 TypeScript，连接官方 Codex app-server。
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/actions/workflows/ci.yml"><img src="https://github.com/keriae/codex-app/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple&logoColor=white" alt="macOS 13 及以上" />
  <a href=".nvmrc"><img src="https://img.shields.io/badge/Node.js-24.11%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24.11 及以上" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文<br />
  <a href="#快速开始"><strong>本地运行</strong></a> ·
  <a href="#功能概览">了解功能</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="docs/README.md">文档</a>
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/raw/refs/heads/main/docs/media/codex-replica-promo.mp4">
    <img src="docs/media/codex-replica-promo.gif" alt="实际运行的 macOS 客户端：发送指令、跟进 Agent 过程、查看工作区并审查变更" width="960" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/keriae/codex-app/raw/refs/heads/main/docs/media/codex-replica-promo.mp4"><strong>观看或下载 MP4 演示</strong></a> ·
  <a href="docs/media/codex-app-preview.png">查看静态截图</a><br />
  录制自实际运行的客户端，使用虚构工作区和确定性演示回复。见<a href="docs/media/README.md">演示说明</a>。
</p>

## 快速开始

需要 **macOS 13+**、**Node.js 24.11+**，以及已配置的 [Codex CLI](https://github.com/openai/codex) 或现有 Codex app-server。Codex 需要单独安装和配置；这个仓库提供桌面客户端。

```bash
git clone https://github.com/keriae/codex-app.git
cd codex-app
npm ci
npm run dev
```

直接打开项目：

```bash
npm run dev -- --cwd="/absolute/path/to/project"
```

默认发现本机 Codex CLI，并启动独立的 stdio app-server。需要选择可执行文件时，设置 `CODEX_BINARY=/absolute/path/to/codex`。

<details>
<summary><strong>连接已经运行的 app-server</strong></summary>

把地址替换成服务器实际的 WebSocket 端点：

```bash
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 npm run dev
```

如果使用支持 WebSocket upgrade 的 Unix 监听器，改为设置 `CODEX_APP_SERVER_SOCKET=/absolute/path/server.sock`。两种地址变量只配置一个。显式连接失败时会报错，不会另启服务器。详见[连接与协议说明](docs/app-server-protocol.md)。

</details>

<details>
<summary><strong>打包本地 macOS 应用</strong></summary>

```bash
npm run package:mac
open release/mac-arm64/Codex.app
```

文档中的打包目标是 Apple Silicon。`npm run dist:mac` 还会生成本地 DMG 和 ZIP。详见[构建与验证记录](docs/source-validation-current.md)。

</details>

## 功能概览

| 使用场景 | 当前能力 |
| --- | --- |
| 跟进 Agent | 流式回复、命令输出、工具过程、审批、追加指令、中断和子 Agent 对话记录 |
| 处理文件 | 项目文件树、CodeMirror 源码编辑、Markdown 预览、自动保存、文件监听和冲突恢复 |
| 审查变更 | Unified、Split 和 Auto 差异布局、词级高亮、本地行内评论，以及文件或选中文本加入输入框 |
| 使用工作台 | 可停靠的终端和浏览器标签、保留本地终端会话、页面查找和缩放 |
| 整理项目 | 项目搜索与置顶、聊天历史、重命名、归档与恢复、对话分叉、本地 Git worktree 创建 |
| 查看集成 | 插件、Skill 和 MCP 清单，已支持的后端操作，以及协作过程 |
| 使用桌面能力 | 原生菜单和快捷键、剪贴板图片、文件对话框、通知和多窗口 |

界面和桌面服务可以在这个仓库中修改。模型、Agent 工具、认证和对话存储由[官方 Codex app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server)提供：

```text
React / TypeScript 界面 → 隔离的 Electron IPC → Codex app-server
```

## 当前局限

功能与视觉一致性仍在完善。这是学习和实验项目，尚未达到与参考应用的完整等价。

- **目前面向 macOS。** Windows 和 Linux 不在当前范围内。
- **部分流程尚未完成。** 远程与云端集成、MCP Apps、语音、完整 Git 审查来源和历史版本预览仍有缺口。
- **验证有具体范围。** 测试通过或一次演示成功，不代表所有交互、故障场景和像素一致性都已验证。

[功能清单](docs/feature-inventory.md)记录覆盖范围，[当前验证记录](docs/source-validation-current.md)说明已执行的检查与剩余边界。演示使用固定回复展示界面行为，不衡量模型性能。

## 常见问题

<details>
<summary><strong>模型和 Agent 工具从哪里来？</strong></summary>

来自你配置的 Codex CLI 或 app-server。模型访问、账户状态和服务器设置使用该安装的配置；桌面客户端不提供替代模型或 Agent 服务器。

</details>

<details>
<summary><strong>需要先安装参考桌面应用吗？</strong></summary>

可编辑客户端需要已经配置的 Codex CLI 或 app-server。另一个可选的本地 runtime 学习流程需要先安装参考应用。详见[反向工程流程](docs/reverse-engineering.md)。

</details>

<details>
<summary><strong>项目如何研究原版实现？</strong></summary>

方法参考 [REA](https://github.com/morluto/rea)，结合直接源码与资源检查、录屏交互、尺寸测量、协议记录和运行验证。详见[方法与证据入口](docs/README.md#reconstruction-and-evidence)。界面代码从 `src/renderer` 开始，桌面服务在 `src/main`。

</details>

<details>
<summary><strong>为什么打开了错误的工作区或服务器？</strong></summary>

检查登录 Shell 中是否导出了冲突的 `CODEX_WORKSPACE`、`CODEX_BINARY`、`CODEX_APP_SERVER_URL` 或 `CODEX_APP_SERVER_SOCKET`。Shell 环境加载可能覆盖命令中的临时设置；外部 app-server 使用自身的配置和凭据。详见[连接说明](docs/app-server-protocol.md)。

</details>

## 一起完善

一次贡献可以只改好一处交互：复现 UI 差异、完善菜单或提示、说明启动步骤，或补充一个协议测试。

- [反馈 Bug](https://github.com/keriae/codex-app/issues/new?template=bug_report.yml)，附上复现步骤。
- [反馈 UI 差异](https://github.com/keriae/codex-app/issues/new?template=ui_mismatch.yml)，提供版本、显示设置和可公开的复现示例。
- [提出缺少的功能或交互](https://github.com/keriae/codex-app/issues/new?template=feature_request.yml)。
- 阅读[贡献指南](CONTRIBUTING.md)，了解环境、验证方式和公开材料要求。

目前重点包括对话与工作台细节、审查流程、重连行为，以及不同主题和窗口尺寸的视觉覆盖。

如果项目对你的学习或实验有帮助，欢迎点一个 **Star**，帮助更多 macOS 开发者发现它。

## 项目状态

本项目独立开发，与 OpenAI 无隶属关系。源码公开供学习，目前没有独立的开源许可证。原始 runtime 学习包和私有录制材料留在本机。[资源说明](resources/README.md)和[媒体说明](docs/media/README.md)记录来源。Codex、ChatGPT、OpenAI 及相关标识属于各自权利人。
