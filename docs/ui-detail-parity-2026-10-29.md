# UI 细节对比与优化 — 2026-10-29

这一轮继续直接读取安装包中的 JS/CSS/SVG，并核对用户录屏，修改可编辑的 macOS 客户端。重点是右侧文件工作台和中间对话活动区。新增实现通过源码测试和打包检查；Mac 锁定期间无法操作复刻窗口，因此本轮没有新的原生截图或逐像素验收结果。完整复刻仍在进行。

## 对照基准

沿用用户指定的 [REA JavaScript application workflows](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)：静态提取 ASAR 模块、解析导出关系、读取实际组件与 SVG 常量，再与录屏帧对照。没有使用 clean-room 方法。此前 REA 6.7 选定模块分析的证据 ID 及范围见 [上一轮说明](workbench-activity-parity-2026-10-29.md)；本轮新增的是更细的静态模块分析和代码修正，没有重新生成完整执行图。

| 基准 | 版本与尺寸 | 使用方式 |
| --- | --- | --- |
| 本机安装包 | 26.1023.50603 / 22391 | 组件结构、状态分支、CSS、原始图标几何 |
| 用户录屏 | 26.1016.61520 / 21421；3878 × 2282；DPR 2 下为 1939 × 1141 CSS px | 8、134、152 秒的文件工作台；299.5、315、401.5 秒的对话过程 |
| 旧复刻截图 | 4112 × 2406；2056 × 1203 CSS px | 辅助定位原有问题，不作为本轮修改后的验收图 |

录屏保存的主侧栏宽度为 468px，旧复刻截图使用 288px 默认值。窗口尺寸和保存的侧栏宽度会改变对话与工作台的位置，不能直接用整幅图的坐标差判断样式偏差。本轮没有为了匹配单张截图强制改变侧栏默认值。

原始模块、视频帧和局部裁剪保留在 Git-ignored 的 `reverse/raw/ui-detail-2026-10-29/`。公开的 [证据记录](../reverse/ui-detail-evidence-2026-10-29.json) 只保留来源、哈希、测量条件和验证结果。

## 逐项差异

下面的“修改后”描述代码实现；原生窗口中的最终视觉效果仍待验收。

| 细节 | 修改前 | 参考依据 | 修改后 |
| --- | --- | --- | --- |
| 工作中标题到分隔线 | 4px | `worked-for-item-content` 的 `gap-2`，录屏 315 秒 | live/terminal 标题改为 8px；完成态折叠控件的 4px 保留 |
| 单命令展开反馈 | 可点击展开，但没有箭头 | `agent-activity-item-row` 的 disclosure | 恢复 14px 箭头；悬停或键盘焦点显示；展开旋转 90° |
| 标题内部间距 | 图标、文字共用一个 6px 间距 | 原 header `gap-1`，内部 summary `gap-1.5` | 外层 4px、图标到摘要 6px |
| 活动图标 | Lucide 替代图形 | 原 renderer 的 SVG 组件与 asset 常量 | 直接恢复读取、搜索、目录、编辑、终端、网页、工具等图标的路径 |
| 已读文件交互 | 文件链接嵌套在整行按钮中 | 原 header 的覆盖按钮与独立文件链接 | 文件使用独立按钮；读取行不附加原版没有的命令输出箭头；compact 模式也保留路径 |
| 悬停与键盘焦点 | 整行变亮，文件链接与展开焦点互相干扰 | 原 `data-agent-activity-file-link` 和 focus-visible 分支 | 展开控件、文件链接分别反馈；点击文件只打开工作台文件 |
| 紧凑活动层级 | 行 40%、详情统一 30%，图标继承行色 | 原 command muted 与 exploration descendants 两条分支 | 命令摘要 40%、探索文字 30%、图标 60%；展开控件悬停或聚焦时文字恢复默认色 |
| 失败与停止图标 | 所有 failed 命令图标变红 | 原 `Hy` 的 interrupted/terminal 分支 | 移除无条件红色；明确报告 interrupted 的命令使用原停止图标 |
| 内嵌输出头部 | 总显示 Shell 与 cwd | 录屏 152 秒没有该头部；当前源码 cwd 只属于 default Shell 面板 | 按录屏内嵌展示去掉额外头部；cwd 不再重复占据一行 |
| Shell 命令提示符 | 没有 `$` | 录屏 152 秒及原 `Xw` | 恢复 `$`，与命令间隔 1ch |
| 命令展示内容 | 直接展示 launcher 与引用包装 | 原 `$w` | 仅对展示与“复制命令”移除 bash/zsh `-lc` 和外层引用；不会执行命令或改变 server 数据 |
| 长命令展开 | 两行截断，点击反复切换 | 原 `Xw` 点击后记录当前命令为 expanded | 初始最多两行；点击或 Enter/Space 展开当前命令 |
| 代码字体 | 12px/18px；全局 mono token 没有定义 | 原 embedded `text-size-chat-sm` 与 `font-code` | 13px/21px；命令常规字重，输出 500；补齐 macOS 等宽字体栈 |
| 输出滚动 | 普通 pre 滚动 | 原 `Xw` 的 144px、column-reverse 与 edge fade | 144px 上限，输出底端跟随，保留横向滚动；支持 2rem 边缘渐隐 |
| 空白输出 | 空白字符直接呈现空框 | 原 `Xw` 使用非空白判断 | 等待输出时保持空白；完成但无非空白内容时显示“无输出” |
| 退出状态 | 12px；无退出码时只显示“未知”；未处理停止 | 原 `oT` | 14px/21px；成功勾 12px；“退出码 未知”；显式 interrupted 显示“已停止” |
| 复制反馈 | 一直显示复制图标 | 原 `UWn` 默认成功状态保持 2 秒 | 成功后显示原勾选图标和“已复制”；拒绝或不可用的剪贴板不产生成功反馈；防止重复等待 |
| 输出展开动画 | 输出立即插入/删除 | 原 exec-shell-body 与既有 disclosure 动画 | 300ms 展开/收起；收起期间 inert；减少动态效果设置下禁用过渡 |
| 文件路径胶囊 | 透明背景、13px 文字、不固定高度 | `review-file-source-breadcrumb` 的 `Yt`，`GE` controlSurface，录屏 8 秒 | 恢复实色表面、32px 高度、14px 文字和 24px 背景模糊 |
| 文件筛选框 | 图标到输入 4px、文字 13px | `review-file-tree-decoration.le` → `hyn(toolbar-action)` | 按当前安装组件改为 8px、14px；保留其圆角胶囊与 12px 横向 padding |
| 运行中输入框占位 | 改成“继续告诉 Codex 要做什么” | 当前 `lZr`/`g8` 的 Codex follow-up；录屏 152 秒 | 普通现有聊天统一“和 Codex 一起工作”；自定义、模式与语音占位优先级保留 |

活动单元 16px 间距、分组子项 4px 间距、分组 224px 滚动高度在已有实现中与参考一致，没有重复改写。右侧标签的 240px 宽度、32px 高度、尾部控件、按聊天恢复浏览器和文件状态沿用上一轮结果；本轮没有新的原生验收来证明它们与录屏完全一致。

## 两个版本的具体差别

录屏 8 秒的文件筛选框呈较小圆角；局部像素边界约为 x=3422–3862、y=195–248（视频像素，含编码与抗锯齿误差）。当前安装源码的 `toolbar-action` 则明确使用 `rounded-full`。因此没有把“截图看起来像 8px 圆角”写成当前版本的 CSS 事实。

录屏 152 秒的内嵌命令输出直接以 `$` 开始，没有 Shell/cwd 头部。当前安装 `Xw` 在 default embedded appearance 下还可能显示简短的 Shell 类型行，在 plain appearance 下不显示。本轮内嵌输出按录屏状态实现；没有声称删掉标题后就覆盖了当前安装版所有 Shell presentation 分支。

右上角摘要卡片在不同构建中的默认宽度与轨道也不同。上一轮已经保留相应尺寸区间，本轮没有把旧录屏的 292px 轨道与当前组件的 308px 布局公式合并为同一个精确值。

## 来源与实现

| 恢复内容 | 原模块或函数 | 可编辑实现 |
| --- | --- | --- |
| 活动标题 | `worked-for-item-content.y` | `styles.css` |
| 活动 header/link/disclosure | `agent-activity-item-row.S/F/m`，`subagent-activity-chip-group.OT/pT/Hy` | `ConversationActivity.tsx`、`conversationActivity.css` |
| 内嵌命令与 footer | `subagent-activity-chip-group.Xw/$w/aT/oT` | `commandOutput.ts`、`CommandOutput` |
| 复制状态 | `app-shared.UWn` | `CommandCopyButton` |
| 图标 | `book-open-d3d308eb0cc1`、`app-shared` 的静态 SVG/asset 导出 | `ActivityGlyph.tsx`；12 个 glyph 的来源与路径哈希保留在证据记录 |
| 路径胶囊 | `review-file-source-breadcrumb.Yt`、`app-shared.zLn` 及 controlSurface CSS | `WorkspacePane.css` |
| 筛选框 | `review-file-tree-decoration.le`、`app-primary.hyn` | `WorkspacePane.css` |
| Codex 占位 | `app-primary.lZr/g8` | `App.tsx` |

## 验证与未完成项

最终 **185 个文件中的 1,413 项测试**全部通过，Node/Web 类型检查和 macOS arm64 打包成功。包校验通过 deep strict codesign、配置 fuses 回读和 **70/70** 当前构建文件逐字节对照；包输出哈希见证据记录。相关定向测试覆盖 shell 引用展示、真实输出保留、pending/empty/interrupted/exit-code 分支，以及 detailed/compact 已读文件的独立导航结构。原始 SVG 到新组件的路径几何通过静态 AST 对照验证；提取出来的原模块没有被执行。

Mac 锁定使原生窗口操作不可用，本轮新增的箭头悬停、展开动画、复制反馈、底端跟随和文件胶囊尚未取得新的图形验收。之前的原生浏览器快捷键和真实模型测试仍是独立历史证据，不替代此次 UI 验收。

剩余重点是同尺寸、同侧栏设置下的原生逐状态对比：长命令滚动与复制、分组内多个动作、文件路径在窄工作台中的折叠与祖先目录菜单、文件树选择与焦点描边、非活动标签关闭按钮、不同工作台宽度下摘要卡片和完整视图。更广泛的 Pierre 编辑器装饰、云端与语音能力仍见 feature inventory。没有将完整功能或像素等价标记为完成。
