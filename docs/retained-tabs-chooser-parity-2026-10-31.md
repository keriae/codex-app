# 已保留标签页 chooser — 2026-10-31

本次依据安装版 **26.1027.30824 / 22943** 的 ASAR JavaScript、CSS、中文词典与原 SVG，按用户指定的 [REA JavaScript 跨层分析方法](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md) 完善标题栏计数按钮。直接追踪原 `Ys → Xs`、shared `fH → Crn/wrn/Trn/Ern` 与 popover primitive；没有采用 clean-room，也没有执行提取出的原版模块。

公开的模块 SHA-256、UTF-8 零起始字节偏移、尺寸、行为与测试记录在[独立 chooser 证据](../reverse/retained-tabs-chooser-evidence-2026-10-31.json)。原录屏 **26.1016.61520 / 21421** 仍属于另一版本；本次没有新增录屏观察或原生操作，不能将它记为当前安装版的 chooser 验收。

## 已恢复的行为

工作台隐藏且存在内容标签页时，计数按钮的鼠标悬停立即打开 chooser，并保留原来的布局点击动作。悬停打开不移动当前焦点；闭态仅 `ArrowDown` 打开并聚焦首个可用按钮，闭态 `ArrowUp` 不打开。打开后，在 trigger 上按 `Enter`、空格或 `ArrowDown` 聚焦首个可用按钮，`ArrowUp` 聚焦末个。弹层内原 `Ys` 只在 focus/key capture 切换鼠标模式，没有行间方向键轮转；副本保留普通按钮的 Tab 顺序。

每个标签的主按钮以 split 模式选择，悬停或焦点进入该行时显示独立 full 按钮。原 `Xs` 使用 `titleContent ?? title`，独立 aria-label 仍为 title。默认条目需要 workspace ready；只有原 factory 已明确证实的 browser 条目在当前映射中设置 `requiresWorkspaceReady:false`。Chat 不计入 retained 内容标签集合。

pointerleave 仅在鼠标打开状态生效。原实现以离开点作为三角顶点、目标的接近边左右各扩展 **8px**，使用三个 signed determinant 判断三角形内点，包含边和顶点。document capture `pointermove` 的 `composedPath` 包含 source 或 destination 时取消关闭；三角内移动重置 **100ms** timer，三角外立即关闭。触发器与弹层两方向都应用同一规则，空几何返回 null。

选择后关闭且不把焦点还给旧 trigger。Escape、外部 pointer/focus 与 window blur 关闭；键盘打开后的 Escape 把焦点还给仍保留的 trigger。点击布局动作前记录 trigger 是否 focused；若是，App 按原 `Ixa` 的下一帧规则查找 main layout toggle/button，再使用副本主 composer 作后备。

## 尺寸与直接源依据

| 来源 | UTF-8 偏移 | 内容 |
| --- | --- | --- |
| `thread-app-shell-chrome-b533951219bb.js` | 31431 `Ys`、36155 `Xs` | retained 内容列表、悬停/点击/焦点/键盘规则、独立 split/full 行动作、readiness gate |
| 同模块 | 38429 `Zs`、38471 `Qs` | full 按钮阻止 pointerdown 冒泡，mousedown 阻止默认和冒泡 |
| `app-shared-7815d5a1a42a.js` | 3343526 `Crn`、3344135 `wrn`、3344468 `Trn`、3344603 `Ern`、3344669 `J0`、3344754 `Y0` | document capture、composedPath、目标边三角、包含边界、空尺寸拒绝、8px |
| 同模块 | 4639754 `gRn`、4644021 `yRn`、4219611 `j3`、4220697 `rbn` | workspace 宽260、菜单 padding8、opaque surface、rounded16、align end、sideOffset5、collisionPadding6、portal zoom |
| 同模块 | 4224370 `Abn` | 图标默认16，内容 gap6，省略号截断 |
| `app-initial-60f141238751.js` | 7711271、6465589 `Ixa`、5269531 `Rhi` | browser readiness 例外；下一帧 main layout trigger 焦点与 primary composer 后备 |

原 macOS CSS token 使 row `h-8` 为 **32px**、rounded-lg 为 **10px**、compact full 按钮为 **24px**、small radius 为 **8px**、text-xs 为 **11px**。heading padding 为6px/8px；主按钮左8px、右36px。chooser 采用原 opaque `#fff/#181818` surface 与 dropdown shadow，16px 方框 count glyph、独立原 full-view glyph；原42项与新增Nr的 registry 数量未改变。计数的8px/600/tabular-nums与超9的6px `9+` 沿用此前已恢复的 titlebar 样式。

原中文为“显示标签页”“已打开的标签页”“以全屏视图打开 {title}”，计数通过独立 aria-description 表达。trigger 与行按钮没有用 native title 替代这些标签。

## 适配与验证边界

当前 `workspaceReady` 取自副本的 `backend.state === 'ready'`，原版取 workspace status atom `Ar === 'ready'`，两者尚未逐项映射。各 tab 的 label/icon 仍来自现有副本 `rightWorkbenchTitleTabs`，不是已恢复的全部原 factory `titleContent/icon`。原选择流程支持物理左右 pane 的 tab 路由和内容焦点恢复；副本本次接入现有右工作台 split/full model，不能据此宣称左右路由和内容焦点等价。primary composer 后备同样使用当前 DOM adapter，没有恢复原注册表。

popup 的逻辑几何与 portal zoom 使用项目既有 `useWindowZoom`；collision/resize 的手工布局尚须原生验证。原 `gRn` 为 z50，副本 chooser 为 z350，适配当前 titlebar overlay 栈。这些是明确的实现边界，不能记为整窗像素完全一致。

本次 Web 类型检查通过，chooser、标题栏、标签身份、view model、键盘和工作台控件的 **6 文件 / 39 项测试通过**，其中新增 chooser **7 项**。测试覆盖三角边界/零尺寸、readiness、split/full identity、count/aria/native-title、nullish title-content 和 trigger key 条件。没有运行本子任务的构建、打包、原版 UI 或副本原生验收。

```sh
npm run typecheck:web
npx vitest run src/renderer/src/retainedTabsChooser.test.ts src/renderer/src/rightWorkbenchTitlebar.test.ts src/renderer/src/rightWorkbenchTabs.test.ts src/renderer/src/rightWorkbenchViewModel.test.ts src/renderer/src/rightWorkbenchTabKeyboard.test.ts src/renderer/src/rightWorkbenchWorkspaceControls.test.ts
```

此前 **204 文件 / 1567 项测试 / 71 个包内文件**、ASAR `e1eee48361d9a4b95ce14b8ad7f95e57d381549cbe03e25337fce31b0cc93cc3` 属于旧 checkpoint，不验证本次 chooser 源码；主任务需另行记录新包的悬停、Down→首行、Tab→full、Escape、split/full 选择与缩放结果。

最终210/1663包原生验证了3条保留标签、260px弹层、32px行、24px secondary、16px artwork、hover打开、trigger Down、Tab次序、Escape恢复trigger、keyboard full与pointer split选择。布局选择后实际焦点为BODY；原main registry/readiness/routes/factory与完整zoom/collision仍未证实。见[最终元素证据](../reverse/ui-element-evidence-2026-10-31.json)。
