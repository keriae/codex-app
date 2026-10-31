# UI 细节完善 — 2026-10-31

本轮按 REA 方法直接核对安装包 JS、CSS、SVG 和用户录屏，继续完善可编辑 macOS 客户端。当前交付已通过 **192 个测试文件 / 1,478 项测试**、Node/Web 类型检查、macOS arm64 打包、deep strict codesign、fuses 回读及 **70/70** 包内构建文件一致性检查。新包原生验收通过命令两级展开与运行计时、三种文件树缩进线、fixture 差异视图、文件链接祖先展开及用户滚动位置保留；测试聊天、临时文件、客户端和隔离 listener 已清理。完整功能与像素等价仍未达到。此前 **190 文件 / 1,462 测试** 的原生记录保留为独立检查点。

## 当前交付快照

前述 **190 文件 / 1,462 测试 / 70/70 包内文件** 与原生截图属于 `acceptance/` 检查点。随后补充的源码记录放在 `acceptance-final/`，已有 **192 个测试文件 / 1,478 项测试通过**，Node/Web 类型检查通过；新包 `report.json` 已通过 deep strict codesign、fuses 回读、**70/70** 构建文件一致性和新增源码哈希对应检查；新包已完成下列局部原生验收，不能沿用旧包截图作为其他新增行为通过的证明。

| 新增行为 | 原始依据和实现边界 | 当前验收 |
| --- | --- | --- |
| 文件树缩进线 | 当前 22943 的 Pierre `spacing-item`、1px border、`translateX(-0.25px)`、150ms hover、0.75 opacity 与半缩进；主树、变更树和目录弹层按已展开 DOM 行绘制祖先列 | 源码和全量测试通过；新包主树 idle/hover、目录弹层两层 hover、折叠及 Right 重开通过。已更改树第二个 fixture turn 显示 +1/−1/M、差异视图和两层 hover guide；虚拟列表、sticky overlay、动态 ancestor-path 高亮仍未完成 |
| 活跃命令两级展开 | compact 摘要 → 224px 区域内的详细命令行 → 原始命令和输出；摘要不显示秒数，详细 foreground 行独立计时；外层关闭立即 inert | 新增 8 项状态 markup 检查及全量测试通过；旧运行截图取得于此修复之前。新包第一次点击显示详细行、第二次显示原始命令/输出，详细计时原生观察 27s→40s→41s。未实现完整 `STEPS_PROSE`/Work detail level；后台 terminal 门控尚未接入/验证 |
| 侧栏当前选择 | 越界时按逻辑 CSS 尺寸居中，考虑 zoom、clientTop 和 scrollPaddingBottom；保留行祖先 ResizeObserver，布局迟到后仍可定位；用户 wheel/pointer/key/scroll 取消，自动滚动事件不取消 | 7 项定向检查及全量测试通过；原生手动 scrollTop 0→200 后保持 200；尺寸调整尝试未生效，完整重排/长侧栏待验收。未实现全部 pin 迁移/reselectionCount 模式 |

原始侧栏证据为当前 `app-primary-95a0e6d83f1e.js`（SHA-256 `e6b2abb4c858523506c5205b7628b106f82c2e043b085fa35be829b8999829f7`）的 UTF-8 零起始偏移 2997913（`revealCanceledByMove`）和 2999472（紧邻 scrollPaddingBottom 的 geometry/scroll）。新增代码归属与边界见 `acceptance-final/source-audit.json`。

旧包已通过原生菜单 `Codex → Quit Codex` 正常退出，原 exec 24389 exit 0，[redacted process ID] 不存在。退出后读取 CUA `getAXState` 自动启动了默认 profile 的新进程 57360；再次原生 Quit 后该 PID 也不存在。这个新窗口来自工具自动启动，不能记为 app quit hang。修正记录在 `audit/quit-residue.json` 和 `acceptance-final/quit-cleanup.json`。

新包在 1420×900、深色、100% 下完成 `sleep 45; seq 1 80`：官方 CLI **0.164.0** / `gpt-6.1-sol`，80 行输出，exit 0，command duration **44,977ms**，最终 `ui-final-hierarchy-ok` 与 fixture 文件链接。点击该链接展开 `lib/deep` 祖先。主树与目录弹层 guide 原生指标为 idle opacity 0、hover 0.75、列 10.25px/19px、线宽 1px。记录见 `acceptance-final/native-evidence-audit.json`、`turn.json` 和相应 AX/截图；第二个真实 turn 只将本轮 fixture 从 1 改为 2，产生 completed fileChange 和 `ui-final-change-ok`；变更树 +1/−1/M 与差异视图通过，hover 指标相同。侧栏仅通过手动滚动后保持位置，完整重排/resize/pin、MCP、多主题矩阵仍待完成；本轮唯一 fixture 聊天删除、通知订阅移除、临时文件恢复和原生 Quit 均通过。一次坐标尝试进入了另一条已有聊天，随后 native Back 返回 fixture；没有向该聊天发送 turn、编辑、归档或删除，记录使用 noOriginalConversationMutations。

为新包验收重新启动了同一官方 CLI **0.164.0** 的隔离 listener，[redacted process ID]、wrapper 57987、exec 61015，地址仍为 `ws://127.0.0.1:4599/`。只读 initialize/model-list 均通过，返回 8 个模型，记录在 `acceptance-final/listener-handshake.json`。该 listener 已安全停止，CLI 57988 与 wrapper 57987 均退出，exec 61015 exit 0，4599 已关闭，原 server 15379 仍运行。当前清理汇总在 `acceptance-final/cleanup-summary.json`；旧 listener 的清理证据保留原检查点归属。

| 当前交付检查 | 结果与证据 |
| --- | --- |
| 源码与类型 | **192 文件 / 1,478 项通过**；`acceptance-final/tests.json`、`typecheck.json` |
| macOS arm64 包 | package exit 0；deep strict codesign、fuses、**70/70** 构建文件一致；`acceptance-final/report.json` |
| 最终源码快照 | 462 个 source hash 未变化，ASAR SHA 与包校验吻合；`acceptance-final/final-snapshot-check.json` |
| 原生局部行为 | 两级命令展开、27s→40s→41s、三树 guides/差异、文件祖先、用户滚动保持；`acceptance-final/native-evidence-audit.json` |
| 官方模型 turn | 80 行 / 44,977ms / exit 0 和 fixture 1→2 fileChange 均 completed；`acceptance-final/turn.json` |
| 清理 | 唯一 fixture、订阅、临时文件、原生客户端和隔离 listener 均清理，原 server 保留；`acceptance-final/cleanup-summary.json` |
| 完整功能 / 像素等价 | **未达到**，下文保留具体边界 |

## 基准与方法

采用用户指定的 [REA JavaScript application workflow](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)，直接读取已安装 ASAR 的目标模块、追踪状态分支和共享资源，再对照录屏。没有采用 clean-room，也没有运行提取出来的原 renderer。本轮复用当前版本的选定模块 REA 分析，并补充静态资源与源码检查点；没有生成或验证完整应用执行图。

| 来源 | 版本 / 构建 | 用途 |
| --- | --- | --- |
| 当前 `/Applications/ChatGPT.app` | **26.1027.30824 / 22943** | 对话活动、MCP 内容、滚动控制、当前图标资源与模块比较 |
| 用户提供的 MP4 | **26.1016.61520 / 21421** | 文件工作台布局和对话活动整体层级，所用帧为 8、150、335、401 秒 |
| 历史静态图标提取物 | **26.1016.62342 / 21477** | 提取 SVG 和文件名匹配表，随后与当前版本逐项确认相同 |
| 历史文件树检查点 | **26.1023.50603 / 22391** | `base-file-tree`、变更树键盘交互与 Pierre spacing/focus 依据 |

当前 REA 证据 ID 为 `ev_3f7ee277754e52956b3b58de0b00ec29e1b482da7b0a5fd4d2227c66074c155f`。各构建的归属及 SHA-256 独立记录在[本轮证据](../reverse/ui-detail-evidence-2026-10-31.json)，不能把旧录屏的尺寸、哈希或观察归给当前安装构建。

## 此前检查点的修改与验证（acceptance/）

| 场景 | 修复后的行为 | 验证状态 |
| --- | --- | --- |
| 文件图标 | 主树、变更树、目录弹层和标签复用原始静态 glyph；保留文件名、完整后缀及复合后缀优先级 | 全量 SVG payload 和匹配规则测试通过；原生外观待补充 |
| 主文件树 | Watcher baseline 刷新保留已有行与键盘焦点；打开本项目文件链接展开必要祖先；恢复 chevron、16px glyph、5px gap、Pierre 半缩进及 1px 焦点线 | 正式包 `lib` 行在 README touch 后的 watcher 刷新及 Left 折叠中保持焦点；完整树状态矩阵待补齐 |
| 已更改文件树 | Roving tab stop，上下/Home/End、左右展开或返回父目录、Enter/Space 激活；文件右键和 Shift+F10 打开菜单 | 键盘模型和路径边界测试通过；原生交互待补充 |
| 文件标签 | `file:doc.id` 解析为当前 document store 的文件路径；拒绝关闭后重开时的旧 ID；右键或 Shift+F10 打开菜单，Escape 返回触发标签；菜单通过 body portal 脱离工作台/titlebar 遮挡，坐标按 zoom 换算并限定在 viewport 内；中键关闭复用保存守卫 | 正式包右键/Escape/Shift+F10、100%/110% portal 和实际物理坐标中键关闭通过；完整菜单/保存矩阵待补齐 |
| 活跃命令 | 当前普通命令路径的非 compact 详细行逐秒更新耗时，完成后使用 server duration；inline compact 活跃摘要按原版保留动作描述；重复开始、历史回放和迟到真实时间不会重置计时 | 定向测试覆盖详细行计时；正式包 20/35 秒命令完成，35 秒运行中 compact 展开已捕获；详细行逐秒数字变化未原生观察；后台 terminal 门控尚未接入/验证 |
| 活动展开 | 请求状态独立于 300ms 动画状态，快速开关可逆；关闭时正文退出焦点顺序；系统及应用内减少动态效果直接生效 | 状态与 markup 检查通过；原生快速开关待补充 |
| MCP 输出 | `plaintext` 表头、192px 正文滚动限制、原始 SVG 和分组缩进；保留 audience/priority/lastModified 注释；图像接入预览，音频失败给出状态，非媒体 blob 可查看 | 内容模型和 markup 测试通过；MCP 多媒体原生矩阵待补充 |
| 原始工具输出 | 结束后提供入口，复制使用 native clipboard；成功反馈 2 秒，失败不显示已复制 | 源码与定向测试通过；原生复制待补充 |
| Composer 正文 | 保留代码缩进、连续空格、CRLF、首尾空白和 Markdown 双空格换行；代码里的插件变量及未知 token 保持字面文本；选中的 chip 前缀可 round trip | 模型测试通过；正式包 110% 原生粘贴逐字一致，缩进、双空格与代码里的字面 `$pdf` 保留 |
| Composer 尺寸 | 字体缩放后的 footer 高度使用逻辑 CSS 尺寸；窗口、pane 宽度或 zoom 变化时重新计算 editor 高度，避免换行后被裁切 | 正式包 110%：textarea 逻辑 205px、物理 225px，footer 273.5355px 与 dock/zoom 换算吻合；完整尺寸矩阵待补齐 |
| 对话滚动 | 内容异步长高保留此前跟随意图；平滑跳转可被用户向上导航取消；加载较早 turn 按可见锚点恢复位置；命令输出 `column-reverse` 的负 scrollTop、SVG 目标祖先及嵌套输出的键盘焦点均参与滚动判断，输出内可消费的输入不会误取消正文跟随 | 正式包命令输出原生上滚 `0→-818.1818`，主对话 top 保持 `655.9091`、距底 `0.09094`；完整嵌套键盘与长历史矩阵待补齐 |
| 侧栏当前聊天 | 未展开项目保留最近 5 条，并追加选中的较早聊天；新选择仅在越界时定位，用户输入取消待执行定位，不强制展开主动折叠的项目 | 项目预览模型测试通过；长侧栏原生定位待补充 |

工作台的详细版本归属和静态图标边界见[文件导航明细](workspace-detail-parity-2026-10-31.md)。命令时间、活动动画和 MCP 内容依据见[对话明细](conversation-detail-parity-2026-10-31.md)。本轮没有把这些局部修复记为完整 Pierre 树、完整 rich editor 或完整 MCP Apps 的复刻。

标签菜单的 chrome 标识指向文档实例，而不是文件路径。现在先以 `file:doc.id` 查找仍存在的文档，再执行既有路径操作；同一路径关闭并重新打开后会得到新的实例 ID，旧事件不能命中重开的标签。body portal 解决菜单被顶栏或工作台堆叠层覆盖的问题，并显式继承 window zoom。正式包已通过原生右键、Escape 返焦、Shift+F10 重开，以及 100%/110% 菜单位置检查；没有由这些局部检查推断全部菜单操作已通过。

命令输出的 `column-reverse` 滚动位置从底部的 `0` 向上变为负值，不能沿用普通容器的 `scrollTop > 0` 判断。共享 helper 按 flexDirection 和实际可滚动范围判断能否向上滚动，事件检查从 SVG 等实际目标遍历至其可滚动祖先；键盘输入还检查当前聚焦的嵌套输出。只有输入将作用于对话正文时才取消正文跟随。

## 此前检查点的后端与验收记录（acceptance/）

本机原有 server 进程使用 stdio，本次检查时没有发现可连接的 TCP listener 或 daemon control socket。为测试副本，主任务启动现成的官方 Codex CLI **0.164.0**，以 `ws://127.0.0.1:4599/` 暴露本轮独立 listener。只读 `initialize`、`initialized` 和 `model/list` 已成功，返回 8 个模型。没有改用户 config，也没有停止原 server；审计探针没有创建聊天或启动 turn。

只读 handshake 证据保留在 `reverse/raw/ui-detail-2026-10-31/audit/listener-handshake.json`。同一临时 fixture 的三个 native composer turn 均由官方 CLI **0.164.0**、`gpt-6.1-sol` 完成，见 `reverse/raw/ui-detail-2026-10-31/acceptance/package-turn.json`：

| 提交界面 | 命令输出行数 | Exit | Server duration | 最终回复 |
| --- | --- | --- | --- | --- |
| Dev renderer | 40 | 0 | 7,922ms | `ui-detail-stream-ok` 和 fixture 文件链接 |
| 正式包 | 80 | 0 | 19,951ms | `ui-package-timer-ok` |
| 正式包，`sleep 35` | 0 | 0 | 34,908ms | `ui-live-timer-ok` |

35 秒命令的运行中 compact 展开状态保留在 `package-live-command.png` 及 AX 记录。原版 `Hj` 的 inline compact 活跃摘要不显示 elapsed；`GT` 的计时启用条件是 `!hideRawCommand` 且 foreground。原版逐秒数字因此适用于非 compact、非后台的详细命令行；副本现有 hook 只门控 enabled 和 inProgress，当前普通详细命令路径由模型测试覆盖，后台 terminal 门控尚未接入/验证。本次检查点原生捕获没有观察详细行数字逐秒变化。不能把 compact 摘要缺少秒数写成缺陷，也不能用完成 duration 证明全部 live header 计时已通过。

本轮两个临时 fixture 聊天已删除，通知订阅已移除，`acceptance/cleanup.json` 的检查通过，原有聊天未被清理。本轮独立官方 listener 及其 wrapper 已退出，4599 不再监听；`audit/listener-cleanup.json` 记录只停止本轮进程，原 server 仍运行。文中的 endpoint 是这次验收使用的地址，现已关闭。

| 检查 | 此前检查点记录（190 文件 / 1,462 测试） |
| --- | --- |
| 源码测试 | **190 个文件 / 1,462 项通过**，见 `reverse/raw/ui-detail-2026-10-31/acceptance/tests.json` |
| Node/Web 类型检查 | 通过，`typecheck.log` exit 0 |
| 官方 server 只读 handshake | 通过，CLI 0.164.0，未启动模型 turn |
| 正式包 runtime | `app://-/index.html`、backend ready/mode daemon；renderer `require` 和 `process` 均不可用 |
| 正式包原生 UI | 标签菜单右键/Escape/Shift+F10、中键关闭及 100%/110% 位置通过；110% composer 精确粘贴/高度、嵌套反向输出上滚、watcher 刷新与目录折叠的焦点保留通过 |
| Native composer 真实模型 turn | Dev 40 行及正式包 80 行、`sleep 35` 三个 turn 均 completed/exit 0；详细行逐秒计时未原生验证 |
| 最终 production build / macOS arm64 包 | `npm run package:mac` 通过，exit 0 |
| Deep strict codesign、fuses 回读、当前 out/ASAR 比较 | 通过，**70/70** 构建文件一致；`report.json` passed |
| 本轮 fixture 与 listener 清理 | 通过：两个临时聊天删除、通知订阅移除、listener/wrapper 退出、4599 关闭，原聊天与 server 保留 |
| 完整窗口像素相似度 | 未计算 |
| 完整功能/像素等价 | 未达到 |

正式包窗口验收为 **1420 × 900**、深色、100% 和 110% 缩放。菜单图片 `package-tab-menu-100.png`、`package-tab-menu-110.png`，composer 图片 `package-composer-110.png` 与 `composer-110.json`，运行探针 `package-runtime.json`，输出滚动 `nested-scroll.json`/`package-nested-scroll.png`，树焦点 `package-tree-focus.ax.txt` 均保留在本轮 `reverse/raw/ui-detail-2026-10-31/acceptance/`。这些局部图片和量测没有覆盖浅色、全部窗口尺寸、MCP 媒体或完整长历史滚动。

可重复的最终源码和包验证命令：

```sh
npm run typecheck
npm test -- --reporter=json --outputFile=reverse/raw/ui-detail-2026-10-31/acceptance-final/tests.json
npm run package:mac
node scripts/reverse/verify-source-package.mjs release/mac-arm64/Codex.app reverse/raw/ui-detail-2026-10-31/acceptance-final
```

## 未完成范围

本轮继续保持[义务清单](../reverse/obligations.json)中的 `shell.window`、`nav.sidebar`、`turn.lifecycle`、`thread.items`、`composer`、`terminal.diff` 和 `visual.regression` 为进行中。仍需补齐全部明暗主题、窗口尺寸、缩放与动画时序；完整 Pierre virtual tree/sticky folder、动态祖先线高亮、git 和 comment 装饰；侧栏 pin 迁移/reselectionCount、`STEPS_PROSE`/Work detail level；原版 rich editor；所有 MCP Apps、连接器图标、审批细节；语音、云端与其他平台集成。测试、原生局部验收和包内字节校验各自验证不同边界，均不能单独证明完整应用一致。
