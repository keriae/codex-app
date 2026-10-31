# 工作台文件导航细节 — 2026-10-31

本轮按 REA 的选定 JavaScript/Electron 资源检查流程，直接阅读原始安装资源、恢复纯 SVG 图标与静态匹配表，并核对用户录屏 150 秒的文件导航。没有采用 clean-room，也没有执行提取出来的原始 renderer。本页记录可编辑源码的具体改善，完整应用一致性仍需独立验收。

## 资源版本与恢复边界

图标最初提取自 `reverse/raw/source/webview/assets/app-initial-dddef47d6ef6.js`，SHA-256 为 `1fc7b685efab4be2d9656e02086180dd9e43dcac0fae1e2b1ec233447ed03843`。这个文件属于 **26.1016.62342 / 21477**，版本归属见 `reverse/source-provenance.json`；它不是用户录屏的 26.1016.61520 / 21421。

随后逐项对比当前安装版本 **26.1027.30824 / 22943** 的 `reverse/raw/ui-parity-2026-10-31/source/app-initial-60f141238751.js`，SHA-256 为 `72b67fc719cccb37a1da02fd06f71d840ec2805b813c1fac3a4fc5cca59cc16c`。当前文件与版本对应关系保存在同目录 `source-manifest.json`。两个版本的 **53 个 SVG symbol、104 个文件名规则、120 个后缀规则、4 个完整集后缀覆盖规则完全一致**。新资源只含这些已核对的静态数据与颜色 token，没有嵌入 app-initial 的执行代码。

`WorkspaceFileIcon` 用于主文件树、已更改文件树、路径目录弹层和文件标签。原先的 TS/JS/M 字母牌与通用线框图标由实际 glyph 替换；完整后缀优先级保留，例如 `.tsx` 为 React、`.mdx.tsx` 为 Markdown、`vite.config.ts` 为 Vite。不根据文件内容推测图标。

SVG 数据允许的元素仅为 `path`、`defs`、`linearGradient` 和 `stop`。颜色使用 `currentColor` 或原始静态颜色；渐变只引用当前 SVG 的 `#id`。测试逐个检查所有 payload，不允许事件属性、脚本、可交互元素、外部 href、远程 URL、data/javascript URL 或内联 style。`dangerouslySetInnerHTML` 的输入只来自版本固定的已核对 JSON，文件路径只用于选择 token，不进入 SVG 文本。

## 导航与菜单改善

- Native watcher 安装后的 baseline 刷新保留已有 keyed 文件行，避免短暂 loading 使键盘焦点、可见层级和搜索结果消失；第一次读取仍显示加载状态。
- 打开本项目的源文件链接时展开所需祖先目录；不会抢走输入框焦点。检查路径归属和 `.`/`..`，不会展开其他项目。
- 已更改文件树接入 roving tab stop、上下/Home/End、左右展开和返回父目录、Enter/Space 激活，并保留层级和位置 ARIA。当前选中变更成为唯一 Tab 入口。
- 已更改文件树支持真实文件操作右键菜单和 Shift+F10；目录不显示“加入聊天”。文件菜单的 nested menu 独立处理键盘导航，Escape 返回原焦点。
- 文件标签右键通过 `codex:workspace-tab-context-menu` 事件复用已有保存/关闭守卫；仅接受当前 document store 中已存在的 file tab 和 finite 坐标。菜单坐标按 window zoom 转为逻辑 viewport 并 clamp。
- 主树和目录弹层只为文件夹保留 chevron，恢复 16px glyph、5px gap、3px 横向内边距以及原 Pierre 半缩进公式（每层 8.75px，嵌套文件补偿 3.75px）。焦点线为 1px；浅色选中背景使用共享表面 token。
- 主文件树、已更改文件树和路径目录弹层恢复祖先缩进线：整个对应树被 hover 时才从 opacity 0 过渡到 0.75，过渡为 150ms ease；线为 1px，祖先列与上述 8.75px 半缩进一致。装饰不参与布局或鼠标命中，折叠文件夹后不再渲染隐藏后代的线。

直接行为/样式依据包括先前 **26.1023.50603** 检查中的 `base-file-tree-967143e06bea.js.pretty` 的 `Xe` 和 `review-file-tree-decoration-1630d78dccd9.js.pretty`。`Qgs` 的 spacing/icon 结构及 Pierre focus-ring/spacing 默认值来自上述 **26.1016.62342** 的 app-initial。图标 payload 和匹配表则另外与 **26.1027.30824** 资源逐项比对。没有把不同构建的整份 bundle hash 误认成相同。

缩进线另外直接核对 **26.1027.30824** 的 app-initial：`spacing-item` 的 `translateX(-0.25px)`、1px border、默认 opacity、`:host(:hover)` 和 150ms transition，以及同文件内 base-file-tree 的半缩进覆盖均可定位。第一条线对应 3px row padding + 7.5px spacing padding − 0.25px nudge，后续每列相距 8.75px。颜色保留 Pierre 缺少主题覆盖时的 `color-mix(in lab, #84848a 25%, transparent)` 公式。这里实现当前 DOM 已展开行的连续祖先列；没有新增或声称完成虚拟列表及 sticky overlay。

## 验证范围

组件和模型测试覆盖 watch 刷新保留行、初始 loading、源链接路径边界、changed-tree 可见键盘顺序、唯一 tab stop、rootless 与深层祖先 guide 数量、折叠后代边界、文件名优先级、复合后缀、全量 SVG payload 静态边界，以及 tab 菜单坐标和无效事件拒绝。Web 类型检查通过。原生交互、最终包和完整视觉矩阵由本轮汇总验证记录单独记载，以上模型测试不替代原生 UI 验收。

本页不宣称 Pierre 虚拟树、sticky folder、全部 git/comment decorations 或全部窗口状态已完全等价。当前源 `data-ancestor-path` 的动态 opacity 1 高亮分支尚未复刻。保留的原始资源和提取报告位于 Git 忽略目录 `reverse/raw/ui-detail-2026-10-31/workspace-icons-extraction.json`。

最终补充包在 1420×900、深色、100% 下局部原生通过主树 idle/hover、目录弹层两层 hover、折叠/Right 重开与源文件链接的 lib/deep 祖先展开。第二个真实模型 turn 只把本轮 fixture 1 改为 2；变更树显示 +1/−1/M，进入差异视图，depth 1/2 guide hover opacity 0.75，列 10.25px/19px、1px border，与其他两种树一致。证据位于 `acceptance-final/guides-*.json`、AX 和截图；完整主题/窗口、虚拟树、sticky 和动态祖先高亮仍未完成。
