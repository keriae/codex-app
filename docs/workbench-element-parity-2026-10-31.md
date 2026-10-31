# 工作台图标与差异视图 — 2026-10-31

本次直接核对安装版 **26.1027.30824 / 22943** 的 ASAR JavaScript、CSS、SVG 与应用图标，沿用用户指定的 [REA 跨层 JavaScript 分析方法](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)。没有采用 clean-room，也没有执行提取出的原版模块。此前录屏的 **26.1016.61520 / 21421** 布局观察仍属于另一版本；本页不把它们记为当前安装版的原生验收。

可公开的版本、SHA-256、UTF-8 零起始偏移、图标路径摘要与验收边界在[工作台元素证据](../reverse/workbench-element-evidence-2026-10-31.json)。源码测试只读取该公开元数据，不需要 Git 忽略目录中的原始应用源码或截图。证据不包含聊天、账户或认证数据。

## 已落实的元素

| 范围 | 当前实现与依据 | 验证边界 |
| --- | --- | --- |
| 原 42 个单色工作台 glyph 与第 43 项文件树按钮 | `WorkbenchElementGlyph` 保留原 42 项记录；root 新增 `file-tree-toggle-original-20`，保留 `Nr` 的 20px canvas，文件树两处按钮按 18px 显示，使用“切换文件树”与 250ms tooltip | `Nr` body SHA 为 `f99bf70a033affbb5716712c02ec821b2581a257bf3415615e9a104006a2065a`。原 42 项历史数量没有被覆盖；独立 Changes controls artwork 另计，不能混算到这份 registry |
| 原生打开方式图标 | `listWorkspaceOpenTargets` 只为已发现的应用读取图标，不把应用路径传给 renderer。`loadMacWorkspaceApplicationIcon` 读取 `CFBundleIconFile`，限制为 bundle `Resources` 内的单一文件名，通过 macOS ImageIO / `sips` 转成 32×32 PNG；界面以 16 CSS px 显示 | Terminal、Finder、Cursor 只读解码成功，实际 PNG 外观不同；文件名边界、格式/大小、失败和临时目录清理测试通过。没有打开这些应用或原版 UI |
| 图标失败后备 | 六种打开目标使用原版 `webview/apps/{terminal,finder,cursor,vscode,zed,windsurf}.png`，保留颜色、alpha 和原始画面 | 后备文件 SHA 已记录；本机没有发现 VS Code、Zed、Windsurf，不能记为它们的原生解码通过 |
| 已保留标签数量 | 原版 `new-tab-button.I` 在 16px 方框 glyph 中央叠加数字；8px、600、tabular-nums，超过 9 使用 6px 的 `9+` | 原始 CSS 与组件 hash 已记录。计数覆盖位置已向主任务提供；本子任务没有重新原生操作标签 chooser |
| 差异视图模式 | `unified → split → auto → unified`；无有效偏好时默认 `auto`，已有明确的 `unified`/`split` 偏好继续保留 | 循环、偏好解析和服务器端 markup 测试通过；模式切换不会写文件或重建评论状态 |
| Auto 有效布局 | 与原版 `Eqa` 相同：文件逻辑宽度至少 **800px**，且解析出的 additions、deletions 都大于 0 才使用 split；其他情况和几何未知时使用 unified | 测试覆盖 799.99/800px、增加/删除/二进制/无改动、流式新增 replacement、缩窄与明确模式。组件通过 ResizeObserver 读取逻辑 `clientWidth`；实际窗口 resize/zoom 尚待原生验证 |
| 三态差异模式按钮 | 单独保留原版 unified/split 的 16px rectangle SVG 与 Auto 的 16px diagonal SVG；内部红 `#F84E63`、绿 `#36D958` 均为 0.5 alpha，边框继承文字色 | 不把这三个彩色 glyph 混入 42 个单色 glyph 规则；原始 payload/hash 和三态 markup 已记录 |
| Changes 窄菜单与控制图标 | `WorkspaceDiffControls` 读取实际 header 的 CSS `clientWidth`，低于 625 时按 Refresh、Word wrap、三态循环、Collapse/expand、分隔线的顺序移入“变更”选项；宽布局保留刷新、换行、折叠、模式的 inline 顺序 | 复用原三态循环，刷新遵循 show/disabled/callback 条件；菜单支持方向键、Home/End、Escape、选中后关闭和焦点返回。more tooltip 使用直接克隆 trigger 的 250ms override。原六份控制 artwork 与新增六份菜单左图标的 body/canvas 已静态核对，运行时交互等待新包验收 |

原生图标读取采用公开的 macOS ImageIO 解码，原版 native helper 调用 `iconSmallForAppPath`/`iconMediumForAppPath`。两者并非相同实现。当前机器上的 Electron `getFileIcon(.app)` 探针返回相同 generic artwork，因此没有用该结果冒充应用图标。

## 差异模式的直接源依据

| 当前安装版模块 | UTF-8 偏移 | 恢复出的行为 |
| --- | --- | --- |
| `app-initial-60f141238751.js` | 7000949 | `Eqa(mode, diff, wide)`：Auto 需要 wide 和两种变更计数；明确模式直接返回 |
| 同模块 | 7001512 | `editorDiffViewMode` 的默认值是 `auto` |
| `code-diff-897faede7272.js` | 31963 | ResizeObserver 将文件 width ≥ 800 转成 wide 状态，初始状态为 false |
| `review-header-toolbar-80664c3cbd49.js` | 16577、17449、21704 | `Be` 的三态图标/按钮、`Ve` 的下一动作 tooltip、`Ke` 的模式循环 |
| `app-shared-7815d5a1a42a.js` | 5599561、5597546 | unified/split 彩色 glyph 的原始 body |
| `auto-diff-4a9039c2e594.js` | 见公开模块 SHA | Auto 的原始三个 JSX path，静态序列化为 SVG 属性 |

副本的 `data-diff-mode` 表示用户选中的模式，`data-diff-style` 表示最终布局。Auto 在窄窗口中仍显示 Auto glyph 和“自动差异视图：改用统一差异视图”，不会因为最终使用 unified 就丢失选择。

按钮使用原版 jA 自定义 tooltip 与 accessible label（已移除原生 title），译文为：unified 为“切换到拆分差异视图”，split 为“将差异视图切换为自动布局”，auto 为“自动差异视图：改用统一差异视图”。

## 本子任务的验证

原生打开方式/静态 glyph 定向检查 **5 文件 / 21 项测试通过**；随后差异模式及既有评论、toolbar、中文文案定向检查 **5 文件 / 37 项通过**。Node/Web 类型检查通过。没有重跑全量打包或操作原版 UI，也没有启动 server 或模型 turn。

```sh
npx vitest run src/main/workspaceOpenTargets.test.ts src/main/workspaceTargetIcons.test.ts src/renderer/src/WorkspaceOpenTargetIcon.test.ts src/renderer/src/WorkbenchElementGlyph.test.ts src/renderer/src/rightWorkbenchWorkspaceControls.test.ts
npx vitest run src/renderer/src/workspaceDiffStyle.test.ts src/renderer/src/workspaceDiffModel.test.ts src/renderer/src/workspaceDiffComments.test.ts src/renderer/src/rightWorkbenchWorkspaceControls.test.ts src/renderer/src/zhCnVisibleStrings.test.ts
npm run typecheck
```

这些检查证明所述模型、payload 与 markup，不能证明浏览器 ResizeObserver 运行、全部鼠标/键盘交互或整窗像素等价。主任务后续的 package/native 记录需要单独归属。

## Changes 控制元素的补充直接源依据

公开的单独记录是[Changes 控制元素证据](../reverse/workbench-changes-controls-evidence-2026-10-31.json)。`Re`（UTF-8 5478）使 inline 组仅在 review-header container 宽度至少 625px 时显示，观察到实际 width/height 都大于 0 后才认为它可见；隐藏时把同一四项操作放进 options。副本使用实际 header `clientWidth` 的同一 625px 门槛，独立处理该 diff 组；root 给 generic 文件 toolbar 增加 `collapseBelow`，diff 传 0，因此这四项不再整体进入通用 dialog。

| 控制图标 | 原始调用链 | authored canvas / 显示 |
| --- | --- | --- |
| Word wrap | shared `lZ → f0 → n2t`，3249177 | 16×16 / 16px |
| Refresh | initial `iJ → CNo`，7900889；`He`，18196 | 20×20 / 16px |
| Collapse | `text-shorter-e92e0eeb7af8.js` 的 `i`，163；`He` | 24×24 / 16px |
| Expand | review header `Se`，942；`He` | 24×24 / 16px |
| Refresh busy | shared `c5 → mBt → $$`，2348956 | 24×24 / 16px，尊重 reduced motion |
| Checkbox indicator | shared `MP/$3.CheckboxItem → dxn`，4244715；默认 `C3`，4215111 | 17×17 / 16px |

这些 artwork 放在独立 `WorkspaceDiffControls.tsx`，保持原始 path 与 canvas；不改写 43 项 `WorkbenchElementGlyph` registry 的统计。`He` 原 class `icon-xs` 对应 16 CSS px。窄菜单 checkbox 保留 right indicator 的 16px 空间，并使用原版单独 17px checkmark，避免用文字字符替代。more 使用已恢复的原版 ellipsis16；刷新 busy 时仅窄 trigger 替换成 spinner，宽 trigger 仍是 ellipsis。

补修的 Web 类型检查通过；差异模式、模型、评论、右工作台控件和中文文案 **5 文件 / 37 项测试通过**；六份独立 payload 的 SHA、宽高及 viewBox 都与公开提取证据相符。副本没有由本子任务启动或打包。这些结果尚不证明菜单运行时的 resize/zoom、鼠标或键盘全部通过。

## root 原生 checkpoint 与补修归属

较早的 203/1550 包 checkpoint 已迁移到 `acceptance-path`，不作为新源码的最终验收。root 在原生副本确认实际文件宽度 826px 的 Auto 使用 split、390px 使用 unified，并从 changed-files tree 打开了 diff 正文。此前 allChanges 首行点击被绝对定位的 48px toolbar 覆盖，未通过；root 为 tool-view content 补 `margin-top:48px`，等待新包再次验证。

root 同时处理 `Nr` 两处调用及窄 diff 外层宽度：宽 native controls 为 224px，采用 inline gap6、去掉原 margin-left4；当内部 file-controls hidden 时收缩外层宽度，避免窄菜单留下 224px 空白。最终 `acceptance` 应独立记录新包对这些补修与 Changes 菜单的原生结果，不能沿用旧包 checkpoint 代替。

## macOS 恢复线程路径修复

最终包验收发现：临时工作区的 app context 使用 `/var/folders/...`，server 恢复的文件变更使用 `/private/var/folders/...`。原先的字面路径边界因此拒绝差异链接，并把工作区相对 breadcrumb/tree 路径变成绝对路径。当前机器只读确认 `/var`、`/tmp`、`/etc` 分别是 `private/var`、`private/tmp`、`private/etc` 的系统 symlink。

`workspacePathModel` 复用原有 POSIX 路径规范化，并仅在比较时折叠这三个顶级系统别名。通过边界检查后，返回值沿用当前工作区根的拼写，使主进程原有 lexical containment 和独立 `realpath` 检查继续有效。差异链接与 snapshot、相对路径显示、breadcrumb、changed tree、目录 reveal、变更文件预览使用同一解析规则；工作台 presentation 缓存使用同目录身份，保留两种拼写之间的选中差异状态。

新增回归从 resumed 的 `+1/-1` 变更贯通 snapshot、差异链接、选中匹配、实际 `WorkspaceDiffViewer` 静态 markup 和文件预览请求，验证 patch 与三态图标保留，且发给主进程的文件路径仍在原根中。双向三种系统别名、`..` 逃逸、相似 sibling prefix 和非系统路径也已覆盖。此次 **9 文件 / 65 项测试通过**，Node/Web 类型检查和 diff 检查通过；这不代替主任务后续的实际包点击验收，也不将此前选中后空正文的问题记为已原生验收完成。

## 只读复核中确认的剩余差异

| 副本调用点 | 原版直接依据 | 仍需完成或验证 |
| --- | --- | --- |
| `WorkspaceDiffViewer.tsx` 的“变更”选项尾部 | `review-header-toolbar-80664c3cbd49.js` 的 `Ue`，18697 | 六项原序、左图标、五个真实全局偏好与消费者均已接入；当前上一轮 source 下复制 git apply 显示禁用，与原 P=null 条件相同。只读 full snapshot、预览格式、parser 覆盖与独立上下文展开仍有下节边界，尚未达到完整像素一致 |
| `workspaceEditorRuntime.tsx` 的文件 toolbar | `review-file-source-item-e733e98d3980.js`，43249 的 `Hi` options、44381 的 git-blame 项 | 副本仍以查找、转到行和 Markdown 模式按钮为主。完整原版菜单的 word wrap、rich view、git blame、内容复制和路径格式尚未接齐 |
| `App.tsx` 的已保留标签 trigger | `thread-app-shell-chrome-b533951219bb.js`，31431 的 `Ys` | 已在独立 `RetainedTabsChooser` 恢复 hover/trigger键盘、普通Tab顺序、100ms/8px三角指针过渡、split/full行动作与布局点击后的焦点规则；[独立实现与证据边界](retained-tabs-chooser-parity-2026-10-31.md)记录readiness、左右路由、图标factory、zoom/collision与原生验收剩余项 |

工作台其余 browser、terminal、summary、loading/error 分支仍有未经本子任务逐项映射的图标。仅凭它们来自 Lucide 不能断言与原版不同；后续应先追到对应原版调用点再修改。完整功能与像素一致仍未达到。


## Changes 尾部与实际消费者补修

`Ue`（UTF-8 18697）尾部的六项顺序为“加载完整文件”“渲染预览”“词级差异”“隐藏空白字符”“隐藏导入内容”“复制 git apply 命令”。前五项是选中后关闭的 CheckboxItem；show flags 默认 true，当前全局偏好默认值分别为 true、false、true、false、false。副本保存并读取完整偏好，兼容之前只有 style/wrap 的记录。原来的搜索和两种路径复制已从这份菜单移除。宽布局的差异模式按钮改用已恢复的 150ms 自定义 tooltip，保留描述下一动作的原中文译文。

六份新增左图标直接来自 shared：`C1/document-light-16`（2609652）、`U1/photo-light-16`（2979791）、`q9n/square-plus-minus-light-16`（5594736）、`mKt/eye-light-16`（2644348）、`b1/cube-light-16`（2593128）、`tGt/clipboard-light-16`（2568920）。原始 canvas 都为 16×16，显示 16px。它们放在独立 Changes artwork 中；原六份 controls 与这六份 tail 共十二个 payload，不合并计入 43 项 `WorkbenchElementGlyph`，已有 checkmark 复用而不重复计数。

| 消费者 | 直接源与本次行为 | 保留边界 |
| --- | --- | --- |
| 完整文件 | `code-diff` 48575 与 full-content-metadata 校验链。副本调用现有 `readWorkspaceFile(cwd,path)`，只对带编号完整 hunk 严格逆向校验当前文本，检查上下文、行数、插删空范围与两侧独立 EOF marker。成功后补齐未改变上下文；失败显示明确错误并保留原部分差异 | 当前磁盘逐 hunk 校验不能证明未触及范围的历史内容。没有原版旧/new Git blob IDs、snapshot generations 与逐段上下文展开/cache。无编号 patch、二进制、读取失败或不匹配不被当作完整历史文件；bare CR 与 mixed 换行会拒绝重建并保留 partial |
| 词级差异 | `code-diff` 47952 → initial `gh` 1350825、`hnt/lnt` 1356285、`Ert` 1390029、`irt` 1373275。直接转写严格 Myers 分词、相同位置 replacement 行配对与 word-alt 单字符合并；变更总行数不超过 2000、两行去掉行尾后 UTF-16 长度不超过 1000 才高亮 | 中文单字符与 astral 的 UTF-16 span 已覆盖；语法 token 内实际渲染 `data-diff-span`。CSS 从 initial 1256407/1256788/1279366 恢复 3px 圆角、clone 和 base alpha .15/.2；整套 Pierre/shadow DOM/token 高亮仍未全部复刻 |
| 空白隐藏 | 原 worker `SE` 510135、520260、`yt` 539564 使用 Git `--ignore-all-space`。仅在验证得到完整 before/after 后，调用 typed `diffWorkspaceText`，通过隔离临时文本执行 `git diff --no-index --no-ext-diff --no-textconv --no-color --ignore-all-space`，使用真实结果重新解析 hunk | 每侧文本限制为 512KiB UTF-8，拒绝 NUL；finally 只清理自建临时目录。root 的四项真实 Git、输入与 cleanup 测试通过。无完整快照时保留部分 patch，重算失败明确显示错误。不会把逐行空白过滤冒充 Git 语义 |
| 导入隐藏 | file-diff-presentation `Ie` 7613、`Le` 8005、`Re` 8624、`ze` 8934。验证后的完整 old/new、非新增/删除、支持 parser、单侧不超过 1e6 字符才处理。只隐藏整 hunk 内全部非空变更都是无 parse error 的顶层 import，允许尾部纯注释但拒绝同一行其他代码；有该文件的评论或草稿 annotation 则保留 | 使用项目现有 JS/TS/JSX/TSX、Python/pyi parser；原 Java/Rust/Go 未扩大。partial/无快照/不支持语言/新增删除原本就保留，不用正则逐行隐藏。diff 搜索域的临时取消隐藏条件还未接入 |
| 渲染预览 | initial `ypr` 4170008 / `bpr`：markdown/md/mdown/mdx/mkd 仅开关开启且非删除时预览，SVG受开关控制，常见位图不依赖开关；副本用实际读到的完整文本、SVG或桥支持的 PNG/JPEG/GIF/WebP 展示 | Markdown 使用现有 ReactMarkdown/GFM，仍缺原版 committed blob、文件链接和精确富文本样式。PDF与未被文件桥支持的位图格式尚未接入；预览读取失败保留原 diff。当前磁盘预览不被写成历史内容等价 |
| 复制 git apply | `cc` 76927 的 caller始终 show=true，disabled=!(I&&P!=null)；`SXa` 7049895 对 last-turn 返回 null，因此上一轮显示禁用行。副本遵循 `disabled || !callback`，没有把单文件 patch 当作整仓库 apply 命令 | 原来源枚举是 last-turn、branch、uncommitted、unstaged、staged、commit，没有 working。当前 Pane 的其他 source labels 尚无真正的 Git review model；全仓 fresh review-patch/cwd/baseBranch/commitSha/hostConfig 处理仍待接入 |

评论仍按 side/source line 编号保存；补齐上下文与 Git 重算后重新解析草稿索引，已保存 attachment 不被模式、词级或过滤开关删除。隐藏后无法放置的评论保留在原有评论区。复制菜单的禁用状态是当前 last-turn 路径的确证行为，不能计为已经支持 branch/full review-patch。

本次补修使用新的专项测试记录；不复用此前 203/1550 或 204/1567 包验收。主任务将构建最新包并用独立 import、whitespace 和 word replacement 的临时 fixture 验证实际消费者，本子任务没有运行 UI 或完整构建。


本 checkpoint 的最终定向验证为 **9 文件 / 122 项全部通过**，Web 类型检查与 `git diff --check` 通过。新增 regression 验证两侧 EOF 的独立变化、mixed CRLF/LF 与 bare CR 拒绝、关闭 full display 后过滤仍要求加载 snapshot，以及 refresh/retry 先失效已加载文件和 Git 重算缓存。Refresh 对同一 id/diff 会递增组件的 file revision，清除之前的 mismatch/error，再读取；原版外部 file-watch/snapshot-generation cache 仍未接齐。

最后核对并替换了附加“跳转到文件”按钮：原版 `Re` 10565 → `Pe` 5326 → `Oe` 2366，是变更文件搜索 picker，不能以打开所选文件源码代替。副本现在接收真实 `snapshot.changes` 和 `selectChange`，按同一 changed-file identity 切换，使用已有原版 `document-badge-magnifyingglass-light-16`（shared `EUn` 4749952）与 explicit250ms tooltip，不增加独立 glyph 数。原 `panelWide` 4222564 为 360px，`list` 4222635 为 250px，副本对应使用这两个尺寸。

Jump picker 的空查询按 filename 再 parent 排序；当前非空查询使用子串过滤。原 `i1` 6962748、`LGa` 6962949、`RGa` 6963064、`lKa/uKa` 6965301 是带词头、大小写、路径分隔符 fallback 和匹配评分的模糊搜索，尚未转写。因此新 picker 的源按钮、实际数据与选中路径已接通，但模糊搜索排序、zoom/collision、原 Command/Popover 精确布局及所有键盘规则仍列为剩余差异。

Wide refresh/collapse 的 `He` 18196、wrap 的 jA caller11554、style 的 `Be` 16577 均没有 openDelay override。shared `jA` 1007301 使用 `u ?? (provider ? undefined : 150)`，provider 默认也为 150ms；当前四项保留默认150ms。Changes more、file tree 与 Jump 明确使用250ms，没有把消息按钮的默认延迟直接套给这些显式250ms调用点。

## root 最终包原生验证

最终 `acceptance-followup` 为210文件/1663测试、71/71输出、503源码hash的独立检查点。45行完整上下文、7→0→2个词级span、6→4→2行增删的Git空白/import过滤、full display=false后刷新、六tail/窄10项菜单、360px实际Jump picker、825.5px split与369.5px unified、3标签的retained split/full与键盘Escape均通过。Rich-preview格式、模糊评分、immutable blobs、扩展parser与全窗口矩阵仍未完成；完整结果和版本归属见[总元素证据](../reverse/ui-element-evidence-2026-10-31.json)。
