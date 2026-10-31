# Shell 元素与调用链审计：2026-10-31

本轮沿用 REA 的 [JavaScript application workflows](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)，直接读取本机安装应用的 ASAR、模块、CSS 和 SVG 字面量，核对权限菜单、摘要按钮、项目与聊天菜单、本地环境及 Composer 元素。没有采用 clean-room。该子任务只读取安装资源及副本源码，未运行提取出的 renderer，未读取或操作原应用的运行中 UI，也未新增录屏逐帧提取。

安装来源为 `/Applications/ChatGPT.app`，**26.1027.30824 / 22943**；ASAR SHA-256 为 `36bf3d2b35e95e11852074b9ca9459b89efbecd6b8311345d060cf66de8f0ba6`。用户提供的 `reverse/raw/video/codex-app-use-screenshot.mp4` 为 **26.1016.61520 / 21421**，分辨率 3878×2282。两份来源的版本独立记录，旧录屏不作为当前 build 每个像素、尺寸和状态的证明。

以下源码偏移均为 **UTF-8 零起始字节偏移**，不是行号。原始资源在忽略目录 `reverse/raw/element-parity-2026-10-31/`，三份主要模块在 `reverse/raw/ui-parity-2026-10-31/source/`。

## 来源与证据

| 原始模块 | SHA-256 |
| --- | --- |
| `app-shared-7815d5a1a42a.js` | `78f88eb7bb88cc8271103ee6e27e7c51c5d44a185b8b4923386f7d207659c0c4` |
| `app-primary-95a0e6d83f1e.js` | `e6b2abb4c858523506c5205b7628b106f82c2e043b085fa35be829b8999829f7` |
| `app-initial-60f141238751.js` | `72b67fc719cccb37a1da02fd06f71d840ec2805b813c1fac3a4fc5cca59cc16c` |
| `thread-summary-panel-components-265aaea48bf8.js` | `66ebaaffd169b4e15b7ba5e03a1bc8785d112baa60b22dcd4a87ddaea481ef6c` |
| `projects-index-page-341fd8b10630.js` | `b68ec0b87145ce9ac9b3b10654f1b81bcb9acaf8c24af83b4c4edbc53176957d` |

证据按用途保存：

- `source-manifest.json`、`environment-source-manifest.json`、`audit-extra-source-manifest.json` 保存模块路径、字节数与 SHA-256，最后一份补充本轮追踪的 9 个模块。
- `shell/shared-icon-assets.json` 保存 shared 的静态 Z 资产表；`direct-svg-assets.json` 使用静态 AST 提取 223 个直接 SVG，其中 222 个完全静态。
- `projects-index-icon-calls.json`、`worktree-environment-dropdown-79f220f47e56-icon-calls.json`、`composer-utility-bar-27a4befc0eb2-icon-calls.json` 保存原调用位置；`thread-menu-icon-source.json` 和 `composer-add-icon-source.json` 保存原字面量及条件分支。
- `source/*.pretty.txt` 保存相关函数的可读输出；`css-open-rotation-audit.json` 和 `button-icon-css-audit.json` 保存状态旋转与自动尺寸规则的静态核对。
- `element-geometry-audit.json`、`shell-element-findings.json`、`remaining-shell-ledger.json` 分别记录冻结时的几何比较、12 项元素结论和剩余差异。`audit-final-snapshot.json` 保存当时 10 个副本 shell 文件的 SHA-256。

## Wrapper、权限与摘要

shared 的资产构造和渲染链为 `e4t`（3303895）、`$`（3306493）、`p4t`（3307620）。默认 `$(asset)` 的第二个 alignment 参数为 `null`，不应用 optical translate/scale；明确使用 `$(asset, "primary")` 时才作光学调整。恢复资产时需要保持调用处的 alignment，不能把资产的 ink bounds 自动用于所有按钮。

`permission-dropdown-0eaba07c2b6c.js` 的 `IW → l5t → $(kWt)` 使用 `chevron-down-md-light-16`，显示为 **16px**。其 trigger 仅设置 description 颜色，`AP → K3`（4254799）及 `axn` 没有加入展开旋转。静态读取全部 **395 份 CSS** 后，未发现匹配该 trigger 的旋转规则。本轮副本保留 chevron 的方向，展开仅改变菜单状态。

摘要图标来自 `thread-summary-panel-components-265aaea48bf8.js` 的 `Rt`（30039）。`summary-59ffc3e03908.js` 实际负责 Usage remaining，不是标题栏摘要按钮来源。

| 元素 | 原资产 | 显示尺寸 | 控件和状态 |
| --- | --- | ---: | --- |
| 普通摘要 toggle | `g0n / list-circle-light-16` | 16px | pressed 改变 secondary/toolbar 颜色 |
| 完整视图或选中 split chat 的摘要 toggle | `H0n / list-circle-light-12` | 12px | `iconMd` 按钮为 20px |
| 原 browser 备用路径 | `W0n / list-circle-light-20` | 20px | 单独记录，不代入 electron 路径 |

`iconMd` 的 JS class 包含 `[&>svg]:icon-2xs`，但 395 份安装 CSS 中没有生成该 descendant variant。此按钮走 `xBt` utility 体系，不受另一套 `._Button_* svg` 的自动尺寸规则影响，因此该调用中的 authored 12px 保留。这里是源码与 CSS 的静态结论，原版实时 UI 和全部 responsive 条件尚未验证。

## Composer 附件

initial 的 `VFr → _Fr → lFr` 区分 pill 和 card。`lFr`（4620966）在 `size="composer"` 时使用 `Are / KN → KCn / xmark-md-light-12`；**glyph 12px、button 20px**。pointer down 与 click 会 prevent default、stop propagation；支持 hover/focus 才出现的移除状态，以及无 hover 环境的可见状态。

默认 card 移除按钮走 `jwe / wP → rSn`，保留原 authored 21×21 canvas，经 `icon-xxs` 显示 **12px**，button 为 **16px**。不能用 composer pill 的 20px 按钮尺寸覆盖该路径。

`_Fr`（4623383）的 leading Icon 使用 `icon-2xs`，electron fallback 为 **14px**，browser 为 16px；具体资产由附件类型决定。本轮修复了已定位 pill 的 leading、remove 尺寸和样式，但没有证明所有 file/image/template 资产及 card/tile/pill 变体。

评论 `$xc` 通过 `VFr` 默认 pill 进入同一路径。原版按评论和 annotation 数量汇总，并允许 selection count 与 popover；副本当前仍按单条评论生成 chips。这是独立的交互差异，恢复图标和 pill 尺寸不能消除它。

## 项目、聊天菜单与侧边栏

`projects-index-page-341fd8b10630.js` 的项目行使用以下 **16px** 资产：

| 调用 | 原资产 |
| --- | --- |
| pin / pinned | `AZt / pin-light-16`、`OZt / pin-fill-light-16` |
| new chat | `u1t / square-and-pencil-light-16` |
| folder / open folder | `XKt / folder-light-16`、`iqt / folder-open-light-16` |
| more | `tz / ellipsis-horizontal-light-16` |
| disclosure | `kWt / chevron-down-md-light-16` |
| edit / archive | `mqt / gear-light-16`、`rVt / archive-light-16` |

项目 disclosure 折叠时旋转 −90° 且 hover 显示，展开时保持 0° 且持续显示。open-chat 使用 shared `dF → T3` 的 authored 20×20，经 `icon-xs` 显示 16px。菜单 edit、archive 由 `n6` 创建 function icon，没有额外尺寸 class，保留 authored 16px。侧边栏项目 hover 的 Edit project 使用 primary `ARn` 内的 `PH(fo)`，`assetIc / X2 → mqt`，同样是无 sizing class 的 authored 16px gear。

聊天菜单另有原始 SVG 路径：primary `dY / kAn` 的 rename 为 `Qin`（21×21），pin、unpin、archive 分别为 `ZW`、`tG`、`dAn`（20×20）。`mc → shared VR / f4` 将它们转为 data SVG URI，随后走 `OP → Wxn → K3 → Item → n6`。`n6` 的 mask span 使用 `icon-sm`，其 **artwork 为 18px**；`F3` 外部 **slot 为 16px**，居中，singleLineRows 下 slot 的 overflow 为 hidden。因此这组菜单图标保留 18px artwork/16px slot，不统一缩成 shared 16px。

后续只读追踪已确认侧边栏聊天 hover 的同一调用链：`PUn → DUn → bUn → _Un` 的 `threadTitleIcon → oOn → QDn`。`QDn`（primary 1731733，导出 `XO`）是 authored 21×21 laptop SVG，`oOn` 的 `icon-2xs` 在 electron 下显示 **14px**，外部 title slot 为 20px 高。默认 tooltip 为“此对话在本地运行。”。原字面量、静态 tree、调用条件在 `shell/local-hover-icon-source.json`，21 份函数与赋值片段及完整映射在 `sidebar-local-hover-icon-source.json`。

`bUn` 的精确显示条件为 `!cOn(He) && !isVoiceChat && (!Ce || isPriorityView)`。`cOn` 认可 worktree、cloud、computer、remote、remote-worktree；`nUn` 对普通本地返回 undefined，对分组本地返回 localGrouped，因此两者可显示 `QDn`。`Ce` 来自 initial `vXt → mW`：Aeon durable state 不为 off，或 summary 的 threadStartKind/threadSource 为 aeon；initial `x3n → US` 同样检查这两个 summary 字段。isPriorityView 为独立 prop，不能用 pinned 替代。

当前副本 ThreadRow 只有 hostId、cwd 等原生 AppServer 数据，缺少完整 worktree attachment/root、voice、Aeon 与 priority 输入；完整显示条件仍未恢复。现有 hostLabel 来自项目关联，远程 projectless 聊天也可能没有 hostLabel，因此缺少 hostLabel 不足以证明本地。父任务仅恢复已建立的普通本地 header 图标路径，用 hostId 判断已知远程；后续 visibility parity 单独列为未完成。

## 本地环境与分支

本地环境 dropdown、Composer utility bar 使用如下资产，均显示 **16px**：

| 元素 | 原资产 |
| --- | --- |
| worktree | `sVt / arrow-branch-light-16` |
| environment / gear | `mqt / gear-light-16` |
| inline branch | `jUt / branch-light-16` |
| 返回 | `LWt / chevron-left-md-light-16` |
| setup / settings 入口 | `EXt / open-link-light-16` |
| selected environment | `hWt / checkmark-lg-light-16` |

分支列表走 legacy SVG：`Zcn` authored 20×20、stroke 1.33；分支选中使用 `C3` authored 17×17。`Thr` 的布局 class 将它们显示为 16px。副本保留 canvas 和 stroke，再由调用处设定显示尺寸。

## Composer 主 actions 与彩色资产

`composer-content-fa640b834e0f.js` 的 project `XB`（264465）使用 `XKt / folder-light-16`；goal `eB`（236608）使用 `eXn / target-light-16`，仅明确 extendedGoal 条件时切换 `F3n / soccerball-light-16`；plan `GB`（262559）使用 `EJt / lightbulb-light-16`。原 browser 的 20px 变体分别记录在 `composer-add-icon-source.json`，本轮选择 electron 的 16px 路径。

Drawing 使用 primary 的 `ai / Jq → jnn → $(oXt)`，为 `multicolor-scribble-light-16`。原始 Z body 有固定 sRGB 绿色 `#04BB9F`，有效 `GR / KR / zBe` wrapper 会提供 `data-icon-p3` 和 `--icon-authored-04bb9f`，支持 `color(display-p3 0.0157 0.7333 0.6235)`。副本保留该 wrapper、变量及色域 CSS；这项 body 比较针对静态推导的有效输出，不直接与 raw Z body 做相等比较。

initial 的 `$Ec` attach action 优先使用 `target.iconSmallDataURL`，img 为 16px、rounded 3px。无 target 图标时才走 `ite / Fh → B4n / appshot-window-light-16`。副本目前恢复了原 fallback，但该 action 尚未具备原版 target metadata。

## 冻结时检查与剩余工作

`element-geometry-audit-25-before-local-hover.json`（当时文件名为 `element-geometry-audit.json`）保留 **2026-10-31 07:04:32 UTC** 的静态比较：`shellElementGlyphs.json` 中 **25/25** 项的 canonical SVG children 与 authored canvas 匹配原来源；scribble 使用上述有效 P3 输出比较，`dataIconP3Set`、`styleTokenSet`、`conditionalMatchesName` 三项均为 true。被比较的 `shellElementGlyphs.json` SHA-256 为 `fc4ba71de42e94b5c451bfaaa3990ab47f747bc9bac1670de47d44318c07a55d`。

几何比较覆盖的是 JSON registry；权限 chevron 等独立 JSX、调用处 CSS、hover、焦点、菜单行为和 packaged 输出的状态各自有证据与验证边界。不能把 25/25 扩大为整个 shell 像素一致。冻结快照中的 App SHA-256 为 `7b393ed087630f6081626bca5e03e962b064cc2ba674b05e75fdbbc20646c22e`，候选行号仅适用于该快照；父任务后续改动与验收以更新记录为准。

父任务随后集成 `local-laptop-legacy-21`，保留 `QDn` 原 body 和 21×21 canvas。ThreadRow 标题后的 host icon 以 **thread.hostId 归属**选择：hostId 为空或 local 时显示 14px laptop，并提供“此对话在本地运行。”tooltip；非 local 即使 hostLabel 缺失仍显示 globe。局部 CSS 仅将 laptop 设为 14px、stroke none，保留其他 host 图标现有样式。这次集成没有增加协议字段，完整 worktree、cloud/computer、voice、Aeon 和 priority gating 仍未实现。

集成后的静态复核将 `element-geometry-audit.json` 更新为 **26/26 body 与 authored canvas 匹配**，P3 wrapper 三项属性仍为 true。当前 `shellElementGlyphs.json` SHA-256 为 `9da29a2676aab12b524fafa960881b16b3d3030f138d2803c56e7e843265f62e`。此前 25/25 的原始 JSON 完整保存在 `element-geometry-audit-25-before-local-hover.json`，并由当前记录的 previousSnapshot 指向；上述 25/25 冻结段落保持原检查时点。新增 laptop 及其调用处只作源码和 CSS 核对，没有运行类型检查、测试或应用。

`remaining-shell-ledger.json` 的 `fullParity` 明确为 false，剩余范围包括：

- 侧边栏本地主机 hover 的完整 special-env/worktree/voice/Aeon/priority 显示条件及其他全局控件的逐调用处确认。`shell-element-findings.json` 记录冻结快照 App 中 44 个 Lucide JSX 候选；候选不等于差异，原版部分模块本来使用 legacy SVG 或 Lucide。
- 评论与 annotation 的 count 汇总、selection count 和 popover；完整 file/image/template 附件的预览、卡片、tile、pill 及 actions。
- Composer attach action 的动态 target 图标 metadata。
- 原版实时 macOS 状态矩阵，以及副本新源码、打包产物与 codex server 的独立验收。

该子任务没有运行新的测试、类型检查、打包或 ASAR 验证。此前 **192 个测试文件 / 1478 项测试 / 70 项 ASAR 检查** 是历史检查点，不能证明本轮之后新增的源码和资产。父任务负责本轮统一验收；本文件不宣称 shell、全部功能或整个应用已完全复刻。
