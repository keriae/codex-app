# 按钮、图标与状态逐项对比 — 2026-10-31

本轮继续使用 [REA JavaScript application workflow](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)，直接读取安装包中的 JS、CSS、SVG 和中文词典，并查看用户录屏的已有帧。没有采用 clean-room，没有执行提取的原 renderer。当前安装来源是 `/Applications/ChatGPT.app` **26.1027.30824 / 22943**；录屏是 **26.1016.61520 / 21421**，两者的几何、状态和版本归属分别记录。

本轮完成的是以下有明确调用链依据的元素恢复。完整应用与像素等价仍未达到。

| 区域 | 本轮恢复 | 源码与剩余边界 |
| --- | --- | --- |
| 权限与 Composer actions | 原始 check/chevron/lock/shield、folder/target/lightbulb/paperclip/appshot、彩色 scribble 有效 P3 wrapper；权限 chevron 展开时保持方向 | [Shell 审计](shell-element-audit-2026-10-31.md)；app target metadata、extended goal 和完整富附件仍待补齐 |
| 项目和聊天菜单 | project 原16px assets；thread 原21/20px canvas，18px artwork 居中于16px裁切 slot | 图标和调用处尺寸有静态依据；完整菜单状态矩阵未完成 |
| 本地环境 | worktree/gear/branch/back/open-link/check，分支列表保留 legacy canvas 与 stroke | 环境编辑与创建的全部交互仍需逐项比较 |
| 标题栏 | tab close、plus、正反完整视图箭头、分屏图标；普通摘要16px与完整视图20px button/12px glyph；retained count 中央8px覆盖，超过9显示6px `9+`；hover/keyboard chooser与每行split/full动作 | chooser已原生验证；完整readiness/route/factory、缩放、窗口、主题矩阵未完成 |
| 本地侧栏 hover | 21px laptop原canvas、14px显示、中文本地运行tooltip；远程按hostId识别 | 完整special environment/worktree/voice/Aeon/priority条件尚未接入 |
| 对话消息操作 | 原copy/check/more/fork；用户复制1.5秒与“复制消息”，回复复制2秒和pending aria；命令复制pending与“复制”aria；用户200ms和回复/命令150ms自定义tooltip，独立指针、focus、层级和滚动行为 | [对话审计](conversation-element-parity-2026-10-31.md)；rich HTML clipboard、跨控件provider、overlay与完整tooltip缩放矩阵仍待恢复 |
| 代码与工具输出 | 36px圆形toolbar、16/20px资产、wrap开关、原JSON共享代码块、520px原始输出dialog、错误/wifi图标；Review/sleep分组前过滤 | 完整错误/重连动效、linked thread accessory与MCP Apps矩阵未完成 |
| MCP resource | `title ?? name ?? uri`及空值语义，移除额外link/icon/details；embedded metadata/content常显 | 本轮静态payload和测试不能证明完整MCP transport或媒体矩阵 |
| 文件工作台 | 原42个单色glyph加独立文件树toggle的20px canvas/18px显示；3个彩色diff模式glyph；compact/regular breadcrumb区别、原生ICNS图标；默认Auto及三态循环；原六项Changes菜单、完整文件/词级/Git空白与import消费者、已更改文件picker | [工作台审计](workbench-element-parity-2026-10-31.md)；完整review/preview服务、git blame、模糊搜索、文件树与chooser完整gating矩阵仍未完成 |
| 差异Auto布局 | unified → split → auto → unified；Auto仅逻辑宽度≥800px且同时有增删时split，其他情况下unified | 保留明确的旧unified/split偏好；仅当前diff组件覆盖，完整原版review服务未复刻 |
| macOS恢复线程路径 | `/var`、`/tmp`、`/etc`与`/private`对应系统路径共用目录身份，文件请求沿用当前root拼写；diff、breadcrumb、树和presentation复用该身份 | 修复原生fixture恢复后变更路径无法映射的问题；保留目录和realpath边界，一般symlink与缓存行为未扩大 |
| 工作台浮动工具栏 | “所有更改”和命令输出内容区与代码/diff一样预留48px工具栏空间 | 204和最终210检查点均已复验首行点击打开实际差异 |

本轮恢复静态资产的独立检查为：shell registry **26/26** canonical body与canvas匹配；conversation **24个glyph路径 / 13组几何指纹**；workbench原 **42个单色 / 3个彩色资产**，随后独立补充第43个单色文件树toggle。Changes控件资产另有独立记录。这些数量不能相加解释为全应用元素数量，也不包含所有调用处状态。

原始证据根为 `reverse/raw/element-parity-2026-10-31/`。`acceptance-initial/` 记录补修前的 **199文件 / 1520测试 / 71包内文件** 检查点及代码wrap、native clipboard、应用图标、文件链接、完整视图原生截图；它不验证后来新增的用户复制时间、错误glyph、Review过滤、Auto与local laptop。`acceptance/` 保留204元素检查点；后续完整Changes、Jump与chooser的最终检查使用独立 `acceptance-followup/`，以[公开证据索引](../reverse/ui-element-evidence-2026-10-31.json)记载的数值和哈希为准。原始截图可能包含本机已有聊天，保持Git ignored，公开索引不包含这些聊天内容。

`acceptance-elements/` 是随后 **201文件 / 1543测试 / 71包内文件** 的独立检查点。原生被动观测记录用户复制成功反馈1499.6ms、回复2001.8ms；第二个官方turn将唯一fixture的`Copy`改成`Copied`，产生completed +1/−1 patch。但从`/var`恢复为`/private/var`后点击变更出现空内容，因此该检查点的Auto原生验收不通过，没有把源码三态测试当成原生通过。随后补充系统别名归一及presentation身份；最新包的检查结果独立保存在`acceptance/`。

`acceptance-path/` 是路径补修后的 **203文件 / 1550测试 / 71包内文件** 检查点。原生文件链接和changed-files树已显示实际`+1/−1`正文；三态循环通过，Auto在826px逻辑内容宽时split、390px分屏时unified。“所有更改”的第一行仍被绝对定位工具栏遮挡，点击命中toolbar，因此该入口未通过。随后补充48px内容间距、文件树独立glyph、复制tooltip和Changes窄菜单；最终`acceptance/`与这一检查点分别记录。

副本验收通过原生CUA输入。只读CDP仅用于读取副本的几何、状态和后台read API，没有发送CDP Input或DOM点击。官方CLI **0.164.0** 独立listener连接本轮临时fixture；原server单独保留。第一轮只读turn完成并返回 `element-native-ok`、120字符JSON及fixture文件链接。后续副本与fixture清理情况、最终原生检查归属见公开证据索引。

当前任务仍需要逐项补齐完整菜单、富编辑器、云端与语音、MCP/审批、长历史、主题、缩放、窗口尺寸和动效状态。源码路径匹配、测试通过、包内一致和局部原生验收各有边界；本轮没有计算完整窗口像素相似度，也没有宣称每一处元素已经完全一致。

最终新增 `acceptance-followup/` 检查点：**210文件 / 1663测试 / 0失败、71/71包内输出一致、503个源码文件hash匹配**。Node/Web类型检查、macOS arm64打包、deep strict codesign和fuse回读均通过。ASAR SHA-256为 `e4336537131a12768489606ca4b44de857deda15c5ba115f1a66005768d44a77`。204/1567的 `acceptance/` 保留为前一元素检查点；复制tooltip原生检查属于前一包，没有冒充新版的再次验收。

最终包原生验证了六项Changes tail的顺序、16px左图标与17px check canvas、上一轮git apply禁用；完整45行的90个两侧gutter恢复为局部16个；词级span从7个关闭到0个，窄过滤后重新启用得到2个；Git隐藏空白使6行增删变为4行，导入整hunk隐藏进一步变为2行；full display关闭后刷新仍正确重新读取与过滤。619.5px header显示四控件加六tail的10项菜单，369.5px内容Auto为unified；825.5px宽内容Auto为split。Jump使用原glyph和360px实际文件picker，原生子串筛选、Enter选择、关闭及焦点返回通过，原模糊评分仍未实现。

[保留标签选择器](retained-tabs-chooser-parity-2026-10-31.md)的悬停展开、260px弹层、32px行、24px secondary、16px glyph、3个标签、trigger Down、Tab到secondary、Escape回trigger、完整与分屏选择均已通过。布局选择后实际焦点为BODY；原main focus registry、readiness、左右route与完整factory矩阵仍需核对，不把这点写成原版焦点等价。Rich Markdown/SVG/PDF的新版原生矩阵未执行。

第三个官方fixture turn完成三处独立 `+1/−1` 的import、空白和单词patch。该turn在前一204包准备，最终210包用完成的实际patch验收消费者。测试聊天已原生归档，可恢复，未永久删除；临时文件、独立profile、副本进程、本轮listener均已清理。没有停止原server：初始PID15379后续不再出现，收尾观测到官方server22973与40962，未对它们发送stop或restart。原安装ASAR仍匹配22943提取hash。最终源码与包hash复核通过。结果及清理记录见[公开证据索引](../reverse/ui-element-evidence-2026-10-31.json)，完整应用和每一处像素一致仍未达到。
