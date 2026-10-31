# 对话区域 SVG 与按钮状态核对：2026-10-31

本轮使用 REA 的 [JavaScript application workflows](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)，直接读取本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 的模块、CSS、SVG 数据及中文词典。安装版为 **26.1027.30824 / 22943**，用户提供的录屏为 **26.1016.61520 / 21421**；两者分别记录，没有把旧录屏当作当前 build 的像素证据。未采用 clean-room，没有运行提取出的 renderer，也没有读取或操作原应用的运行中 UI。

原始资料保存在忽略目录 `reverse/raw/element-parity-2026-10-31/conversation/`。`glyph-source.json` 记录每个恢复 SVG 的 canvas、函数或资产名、原始 body 与几何摘要；`existing-glyph-audit.json` 记录修改前已有图标的路径匹配；`element-audit.json` 汇总状态、CSS 和验证边界；`tooltip-source-audit.json` 保存两套copy tooltip的精确调用链、事件/几何和最终11个renderer源码指纹。以下源码偏移均为 **UTF-8 零起始字节**，不是行号。

## 当前版本 SVG

新建 `conversationElementGlyphs.ts` 只保存静态 canvas/path/fill 数据，通过现有 `ActivityGlyph` 渲染，没有嵌入原 renderer 的执行代码。

| 副本 glyph | 安装源符号 / 资产 | 源偏移 | 源 canvas | 使用位置 |
| --- | --- | ---: | --- | --- |
| `copySmall` | `dz` / `square-on-square-light-16` | 1213579 | 16×16 | 代码工具栏复制 |
| `checkSmall` | `$R` / `checkmark-md-light-16` | 1203863 | 16×16 | 代码工具栏复制成功 |
| `codeOverflow` | `J0t` / `text-overflow-light-16` | 3241081 | 16×16 | 未开启自动换行 |
| `codeWrap` | `n2t` / `text-wrap-light-16` | 3249177 | 16×16 | 已开启自动换行 |
| `codeLanguage` | `v1` / `code-light-20` | 2582996 | 20×20 | 代码表头 |
| `more` | `tz` / `ellipsis-horizontal-light-16` | 1204848 | 16×16 | 回复更多操作，主任务集成 |
| `fork` | `sVt` / `arrow-branch-light-16` | 2400128 | 16×16 | 回复分叉，主任务集成 |
| `close` | `rSn` | 4295343 | 21×21 | 默认原始输出对话框关闭，渲染为 16px |
| `contextCompaction` | `d5n` / `text-select-light-16` | 5464221 | 16×16 | 上下文压缩状态 |
| `code` | `Mvn` | 4158517 | 21×21 | 原始工具输出入口，渲染为 12px |
| `read` | `dUt` / `book-open-light-20` | 2489789 | 20×20 | 文件读取与探索摘要，现有活动容器渲染为 16px |
| `systemError` | `Y5` / `circle-exclamation-mark-light-16` | 4611947 | 16×16 | 不重试的错误行 |
| `streamError` | `p5n` / `wifi-light-16` | 5466328 | 16×16 | `willRetry=true` 的错误行 |

修改前 12 个已有 glyph 中，11 个的每条 path 字面量仍存在当前 shared 模块；旧 `read` 的路径不在 22943 中，因此本轮恢复当前 `book-open-light-20`，删除原 registry 的旧 `read` 条目。新 `read` 的 geometry SHA-256 为 `9bc2e826b30f738d14118cf79d0799de473fc5efb231391d5bb71ce727f628d5`。已有 glyph 的字面量匹配仅证明路径在当前源码中，不能单独证明每个调用位置、渲染尺寸与颜色正确。

消息复制与代码工具栏复制使用不同图标。用户消息使用 `Nqn`（4841464，21×21）与 `C3`（4215111，17×17），分别由共享模块 `PC/pF` 导出；`user-message` 模块使用这组资产。回复同样使用默认 CopyButton 的这组几何，但用户复制有独立状态逻辑，并非 `Fqn`。最终 `MessageCopyButton` 使用明确 `user/reply` variant，App 的用户 call-site 传 `variant=user`；回复 tooltip 为“复制回复”、默认 aria label 为“复制”；用户 tooltip/aria 为“复制消息”。代码工具栏使用上表 16px 小图标，不能相互替代。

## 代码工具栏与复制状态

当前 shared `sJn`（4853473）是默认 CodeSnippet，`lJn`（4859580）提供表头：48px 最小高度、8px 左侧间距、中等屏幕左内边距 20px、右内边距 6px、controls 间距 1px。源码 `imageToolbar/uniform/ghostActive` 的按钮为 36px 圆形。代码外框直接使用 `--radius-3xl-base`，为 20px，不依赖 dialog 的圆角倍率。

CSS 1354493 的 `[data-codex-window-type=electron]` 把 `--text-sm` 覆盖为 **13px**，所以代码表头是 13px/500，继承 1.5 行高；不是通用网页 token 的 14px。语言图标为 20px，两个工具按钮图标为 16px。本轮移除 wrap 按钮的持续选中填色，保留 hover 与独立 focus ring。

| 状态 | 文案与图标 | 恢复行为 |
| --- | --- | --- |
| 未换行 | 启用自动换行 / `codeOverflow` | `aria-pressed=false`，正文 `white-space:pre` |
| 已换行 | 禁用自动换行 / `codeWrap` | `aria-pressed=true`，正文 `pre-wrap` 与 anywhere wrapping |
| 可复制 | 复制代码 / `copySmall` | 使用 native clipboard 服务 |
| clipboard pending | 保持普通图标 | `aria-busy` 与 `aria-disabled`，拒绝重复写入 |
| 复制成功 | 已复制 / `checkSmall` | 2 秒反馈期间取消 click handler，随后恢复 |
| 复制失败 | 保持复制代码 | 清除 pending，不显示成功，允许重试 |
| 卸载后完成 | 无 UI 更新 | 不写卸载组件状态，不安排反馈 timer，取消已安排 timer |

shared `Fqn`（4845515）使用 pending ref、挂载 guard、成功反馈及 2 秒 timer；inline 变体才是 1 秒。本轮只实现现有默认代码 toolbar 路径。wrap tooltip 延迟 200ms，copy tooltip 延迟 150ms，对应 `$0`（3345258）与 `jA`（1007301）的默认值；其他 `ActivityTooltip` 调用保留原行为。

中文词典 anchors：换行 disable/enable 为 821877/821925，复制代码 1226090，复制回复 154161，更多操作 154368，复制消息 1076201。

默认主题的可直接解析 token 已对齐：代码 surface 为 dark `#181818`、light white，加 dark white8% / light foreground5% 的 CodeSurface gradient；表头前景 dark `#dfdfdf`、light `#1a1c1f`；hover 同为 white8% / foreground5%。`border-subtle` 经 CSS 223298 和 249436 的最终 cascade 为 dark white4% / light foreground5%，替换旧 7% / 8% 描边。运行时自定义主题覆盖、完整语法高亮 palette、正文代码字号和全部 responsive viewport 状态未在本轮逐项证明。

## 工具输出入口和弹窗

MCP 模块约 45466 使用 `IF` 导出的 `Mvn`，class 为 `icon-xxs`，CSS 128467 明确为 12px。入口仅在结束后的展开内容里提供，默认透明，在工具 hover/focus 时出现，tooltip/aria 为“显示原始工具调用输出”。本轮恢复 `</>` 字形，移除 Braces 图形，按钮使用 ghost 的默认前景及 hover 色。

原始输出由 shared `LSn` → `HSn` 渲染默认 dialog。`ISn`（4298075）的默认 `w-130` 为 **520px**，最大宽度 92vw。`aCn`/`cCn`（4319687/4321965）配合 CSS 74230/74338：body padding 20px，第二 section 顶部间距 12px。标题由 `iCn`（4317426）提供 heading-dialog、600 weight、28px 行高；CSS1352705 的 shared body 将 heading-md 覆盖为 **18px**。随后20px覆盖只适用于browser/chrome-extension body，extension root的16px也不适用electron。副本使用18px/28px/600。

默认关闭按钮使用 `rSn`，位置 top/right16px、padding4px、4px radius、图标16px；中文 aria“关闭对话框”来自词典 873568。对话框 default surface 是 90% elevated secondary 和 blur24px；默认 elevated secondary 在 CSS 237844 回退 app surface，因此本轮使用 dark `#181818`90% / light white90%。overlay 源 CSS236475 为 `#0002`。默认圆角20px；支持 `corner-shape:superellipse(1.5)` 时，安装 CSS1361775 的 scale1.25 对应25px superellipse。

MCP source 46296 在 dialog 第二 section 中使用共享 JSON CodeSnippet，`max-h-128` =512px，提供 wrap/copy。副本原先的 640px 弹窗、自制 pre 和悬浮“复制原始输出”按钮已改为 `CodeBlock language=json`，继承共享复制状态和代码工具栏。旧 `.tool-raw-output-dialog button`、`.tool-raw-output-code button` 全部移除，关闭样式仅约束 `.tool-raw-output-close`，不会覆盖 CodeBlock 圆形工具按钮。Escape、背景 pointer dismiss、Tab loop、关闭后焦点恢复沿用现有副本实现；与原 Radix dialog 的完整原生行为尚未逐项比较。

## Resource 内容

当前 MCP source 56025 的 `resource_link` 只有“Read {resourceLinkName}”文本与 annotations。词典 911303 为“已读取 {resourceLinkName}”，名称使用 `title ?? name ?? uri`，包括空 title。原 source 不显示 description，也没有文件图标、外链图标或链接控件。本轮改为该文本与注释结构，保留空值优先级；移除原副本自制 FileText/ExternalLink 链接行。

source 56806 的 `embedded_resource` 直接显示 URI、可选 MIME 类型、annotations，以及非空 `text ?? blob ?? ''` 的内容。词典 908307/908366/908421/908482 提供注释、内容、MIME 类型、URI。原实现没有多一层 details 折叠，也不会把 resource blob 转换成图片或音频。本轮恢复常显 metadata/content，移除 FileText/chevron、媒体转换；空 text 优先于非空 blob，且省略空内容 section。source 内容区最大192px、上下8px/左右12px padding。独立 image/audio content family 继续使用已有图像预览与 audio metadata/failure 状态。

## 证据与验证边界

| 本次原始模块 | SHA-256 |
| --- | --- |
| `app-shared-7815d5a1a42a.js` | `78f88eb7bb88cc8271103ee6e27e7c51c5d44a185b8b4923386f7d207659c0c4` |
| `subagent-activity-chip-group-c4bbde85e58a.js` | `1dbddde69468dcf6d54f04d89b6ad065246f85ed871aa8d1f47a1b9a8a7d95d2` |
| `mcp-tool-item-content-97e8bcba351c.js` | `d12a10c21c1b45fc29173d57e15996194415309646dd614b997c7cbcc7b0d008` |
| `chatgpt-code-block-082f08f8e478.js` | `3f0a4a1d30b14810d96426173005dccf64cac72c06622fdc02ba1e1c8d7997b5` |
| `user-message-39c939dd877c.js` | `e3d90cac99716b3478aff20b86a7be0c5c044417b597b763c12813331d5a4f79` |
| `5257da4ba4ae.css` | `6c0b62be9ea2b0268a114414a05365744206eab52b3c14b66ec6eceb063d23e0` |
| `zh-CN-88ebb426d686.js` | `672ea7570754a484585121ddbbbbbba078e95f51ecf68db6e4f901a011577745` |

本轮离线检查录屏152秒帧 `reverse/raw/ui-audit-frames/frame_0152000ms.png`：文件探索分组、展开的 command output、成功行、上下文自动压缩状态可见。该帧支持层级和状态位置，不包含完整代码 toolbar 交互与 MCP raw dialog，也不能证明新 build 的每个字形或颜色。

最终代码定向 **9 个测试文件 / 70 项通过**，包括11个当前 SVG canvas/path 指纹、copy pending/失败/2秒/卸载/换行独立性、raw JSON 工具栏与样式隔离、resource 名称与 blob 语义，以及 workbench recents/summary 的消费者回归。Web TypeScript 与 whitespace 检查通过。最后仅调整两组默认主题 CSS 后，相关3个文件/22项再次通过。

`codeBlockCopy.test.ts` 通过持久 hook cell 的替身执行真实按钮 handler，`rawToolOutputDialog.test.ts` 以替身 portal 静态渲染内容；这些不是原生挂载、真实鼠标焦点或 clipboard bridge 验收。`mcp-result-fixture.json` 是最小测试 payload，没有配置 MCP server、注入生产历史或声称从真实 MCP transport 得到。

## 冻结后的复核与三项补齐

随后只读复核找到3项确证，主任务明确派发后进行最小修改，并再次冻结 renderer。没有运行原版 UI，也没有为这一补充重新做全量打包或全量测试。

| 元素 | 当前安装源证据 | 最终副本位置与行为 |
| --- | --- | --- |
| 用户消息复制 | `user-message` 15039 的 `K` handler 仅用 `V.current` 阻止重复写入；15417 的成功 timer 为1500ms；17531 的按钮仅传 aria-label/onClick，不传 pending busy/disabled；17063 选择 `codex.userMessage.copyAriaLabel` | `MessageCopyButton.tsx:6` 的 `user` variant；`App.tsx:9484` 仅用户 call-site 新增 variant。aria“复制消息”，保留 pending ref，pending不设置aria-busy/aria-disabled，成功1.5秒 |
| 回复复制 | shared `Fqn` 4845515，默认2秒、pending两个aria属性、mounted guard | `MessageCopyButton` 默认 `reply` variant；回复仍“复制”/“已复制”，2秒及pending busy/disabled，不被用户分支改变 |
| 命令/输出复制 pending | activity module 163630/164528 调用 `we`，`we` 从 shared `MC` 导入，即 `Fqn`；shared 4847498 的 `ee=z=pending||undefined`，4849442 传 aria-busy/aria-disabled | `ConversationActivity.tsx:62` 同时设置 busy与disabled；原先仅busy的遗漏已补齐 |
| Review/sleep 事件 | app-initial `mwo` 7759332 在7762154遍历 items、7762754按type转换；没有Review/sleep输出case。`Cwo` 7779777调用 `Ewo`（7780737），7780850 的 enteredReviewMode/exitedReviewMode/sleep均返回false | `conversationActivityModel.ts:24` 在projection/grouping前过滤；`ToolActivity.tsx:93` 对直接调用也返回null。移除旧Review Check分支，不再产生generic“已使用 Entered/Exited Review Mode”行或隐藏事件造成的分组边界 |

原版用户 copy 在15039附近向 `se` 提供纯文本，或同时提供 `text/plain` 与 `text/html`；最终副本 bridge 仍只有 `src/shared/api.ts:638` 的 `copyText`、preload的 `app:copy-text`、main的 `clipboard.writeText`。本次没有新增HTML clipboard接口，因此HTML格式、原版DOM复制文本选择和分析事件仍未恢复；不能把用户复制的全部能力声明为一致。副本用户 copy 额外保留了现有mounted/timer cleanup保护。原版用户 tooltip 在17531之后由自定义 `w` wrapper提供；此检查点副本仍用HTML原生title，下一节记录后续tooltip补齐。

此补充的7个定向文件 **85项通过**，Web TypeScript、whitespace通过。该检查点新增 `messageCopyButton.test.ts` 的6项使用持久hook cell执行真实handler，覆盖两个variant的pending属性、独立反馈时间、失败重试、卸载，以及command pending disabled；不会证明真实原生clipboard或focus。新增过滤检查覆盖 projection/hasConversationActivity、turn partitions、实际TurnBlock markup及ToolActivity直接调用。已有用户action markup断言由“复制”修正为“复制消息”。

## 错误字形与命令复制标签收尾

主任务再次明确派发两组错误字形和command/output复制aria的最小修改。不重试error在app-initial 7769187形成system-error，activity `yb` 41465使用 `pr`，shared `oO` 导出 `Y5`；本轮将Lucide AlertCircle替换为静态 `circle-exclamation-mark-light-16`。`willRetry=true` 在相同转换中形成stream-error，activity 41262使用 `Sn`，shared `gf` 导出 `p5n`；本轮将RotateCw替换为静态 `wifi-light-16`。原16px渲染尺寸、错误message/details、retry class和颜色保持现有实现；没有扩大到源 `Wg/lk` 的专用错误结构或重连行为。

两组geometry SHA-256分别为 `520754940aa553cd86ed90f2dc9c84c14bf90d47df5ce80b6f845d8ed8efa75c` 和 `4ddc2a356b85640a820eed8d63a7376f1303bd65185fcd1439aeee7af26bec45`。最终registry共24个glyph，其中13个恢复geometry有独立源指纹；24个glyph的全部path字面量均在当前shared模块中。静态独立复核确认systemError为3条path、streamError为4条path，canvas/fill/clip规则与源资产一致。

activity 163630/164528的 `we/Fqn` call-site只传 `buttonText`（复制命令/复制输出），未传 `ariaLabel`；副本 `CommandCopyButton`在此检查点恢复默认aria“复制”，title仍分别为“复制命令/复制输出”，成功时两者均为“已复制”。pending busy/disabled与2秒反馈保持不变。下一节记录随后将原生title替换为自定义tooltip。

此收尾的 **5个定向测试文件 / 70项通过**，whitespace通过；Web TypeScript曾被共享checkout的 `App.tsx:8110` 缺少 `ActivityTooltip` 导入阻塞，主任务修正后在后续tooltip检查点复验通过。没有重复全量测试、打包或原生UI验收。glyph suite覆盖13组完整几何指纹及两种error的实际调用点、message/details/retry class；copy suite在此检查点为7项，分别核验command/output的aria与title及pending/成功/恢复状态。

## 消息与命令复制的自定义 tooltip

主任务明确派发后，仅修改 `MessageCopyButton.tsx`、`ConversationActivity.tsx`、共享 `ActivityTooltip.tsx/activityTooltip.css` 和定向测试。其余活动tooltip保留已有400ms默认与布局；恢复的源样式通过显式variant启用。所有原生title已从这4类复制按钮移除。新触发器将ref、事件与aria合入原按钮，保留原class、绝对定位及既有description，不增加会改变命令按钮锚点的flex wrapper。

| 调用点 | 安装源码调用链 | 副本行为 |
| --- | --- | --- |
| 用户消息复制 | user-message import574 `sH as w` → shared export6205158 `$0 as sH`；user17647只传 `tooltipContent:ht`。shared3345495默认 `delayDuration??context??200`，3345626 `Lrn` → 3355194 `Rrn` | 独立 `userCopy` variant；“复制消息/已复制”，hover200ms，focus-visible立即显示；pointer enter/move可触发，click后移动阻挡直到重新enter/focus。无trigger/outside pointerdown关闭，blur/contextmenu/Escape/window blur即时关闭，滚动更新位置 |
| 回复复制 | activity135801 `we` 的 `buttonText` 为 `assistantMessageContent.copyResponseTooltip`（词典154161“复制回复”）；`we`为 shared `MC/Fqn`，4845515默认CopyButton，4850107调用 `jA` | `copy` variant；tooltip“复制回复/已复制”，aria“复制/已复制”，hover150ms，focus-visible立即显示；pointermove打开，pointerdown/click/blur/leave/Escape关闭 |
| 命令/输出复制 | activity163630/164528 `we`，分别传复制命令/复制输出；Fqn只把buttonText传给 `jA.content`，成功改为Copied | 同一 `copy` variant；tooltip“复制命令/复制输出/已复制”，aria仍“复制/已复制”，保留pending busy/disabled和2秒成功反馈 |

新 `jA` 位于shared1007301：默认delay150，1009048 `NA` 最大320px；Electron `_x` 默认offset2、collision8来自776063/776117/776151，最终合并在777941。Radix `sje` 1000702默认top，Popper默认align center；trigger999468只对非touch首次pointermove打开。focus必须通过jA的 `:focus-visible` 检查；click只调用onClose，不能套用用户路径的额外clicked阻挡。keyboard focus打开后点击、随后发生首次pointermove，源新路径可重新打开，副本已单独覆盖。

旧 `Rrn` 默认top/center、offset2和collision8（3356492/3356568），最大 `min(20rem, availableWidth, 100vw-16px)`（3360549），并从trigger继承 `--side-tooltip=bottom`（3357193）。副本在layout前测量实际button/popup，应用2px偏移、8px屏幕边距、顶部/底部flip和水平shift；用户保留继承bottom与scroll跟随。两类都保持点击关闭后文案变化不会强制重新打开。300ms内同一副本tooltip再次hover可立即显示，对应新Radix本地provider skip300与旧provider默认skip300；旧provider按同key共享的完整跨控件范围尚未证明或实现。

两套默认Electron几何相同：13px/430、18px行高、横12px/纵5pxpadding、−0.15px字距、16px圆角；支持superellipse时20px/`superellipse(1.5)`。旧路径的utility证据为shared3360169、CSS562893/566440/594069；新 `_Tooltip_11i4f_2` CSS33158及tokens203243–206439。最终border在CSS245504为tooltip文字5%，shadow251939为 `0 8px 18px #0f172a33`。默认light背景 `#1a1c1f`、white文字；dark背景 `#181818`、文字 `#dfdfdf`，100%不透明；颜色链为228600/228755 → 238700/237844 → 213242/209153。旧内层保留text balance。普通tooltip均无箭头，没有源动画class。

渲染边界也分别恢复：旧Rrn使用 `z-50`（shared3358870/CSS315859）和 `pointer-events-none`（3360433）；新jA的Popper在878800读取content自身computed zIndex，878871传给wrapper，默认auto；DismissableLayer在1002745/821306默认指针auto。副本 `userCopy` 为z50/指针none，`copy` 为zauto/指针auto。

此检查点 **5个定向文件 / 47项通过**，Web TypeScript和whitespace通过。新 `copyTooltip.test.ts` 的17项用持久hook cell、测量矩形和事件替身执行真实handler/layout计算，覆盖150/200ms、明确250ms override、focus覆盖pending、触摸、点击后的不同hover行为、内外pointerdown/关闭、继承bottom、flip/shift、scroll跟随、卸载和样式范围。原copy状态7项与代码copy/disclosure/实际TurnBlock回归均保留。没有使用任何UI，也没有全量构建或新增HTML clipboard桥。主任务已复用同一源jA样式供另两处250ms tooltip调用；本记录只证明上述默认复制路径和显式延迟能力。

## 仍保留的逐元素差异

Review行已移除，两种error字形与command aria已补齐。以下结构、状态或控件映射仍保留。

| 元素与副本位置 | 当前安装源依据 | 剩余差异 |
| --- | --- | --- |
| 非retry错误 `ToolActivity.tsx:95` | app-initial 7769187 将不重试error转换成system-error；activity `yb` 41465 使用 `Y5/circle-exclamation-mark-light-16`，随后走专用 `Wg` 组件 | 字形已恢复；副本仍是简化消息/details行，text/60颜色、完整专用结构与原生状态尚未逐项对应 |
| retry错误 `ToolActivity.tsx:95` | 同一转换在 `willRetry` 时形成stream-error，并调用 `bwo/xwo`合并重连次数；activity `yb` 41262 使用 `p5n/wifi-light-16`；`lk` 278110显示重连进度和详情 | wifi字形已恢复；重连数字滚动、errorInfo文案、details展开动画与完整原生状态尚未对应 |
| linked-thread按钮 `ToolActivity.tsx:111/117` 的 Lucide ExternalLink | 副本只按 `read_thread/send_message_to_thread` 的 `arguments.threadId`生成附件按钮；当前已检查MCP/activity模块，但尚未建立同一触发条件到原版具体glyph/控件的映射。app-initial 2436149/2447956存在独立attached-threads projection | 尚不能确认原版应有同样通用header按钮，也不能把现有Lucide路径声称为直接恢复；需要独立目标行为与实际tool payload证据 |

上述4类copy的默认自定义tooltip已恢复。旧U0和新jA的完整provider范围、跨控件skip/handoff、默认portal container与其它overlay叠放、缩放及完整Floating UI位置跟随、自定义tooltip tokens/theme覆盖尚未逐项对应；不能据此声称所有tooltip状态完全一致。

STEPS_PROSE/Work、后台terminal timer gate、完整MCP Apps/connector logo、所有审批详情仍属于前一份[对话细节记录](conversation-detail-parity-2026-10-31.md)中的未完成边界。主任务统一执行新版包原生验收；本文件不宣称完整对话区域、完整像素或整个应用完全等同。
