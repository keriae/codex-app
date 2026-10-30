# 工作台与对话过程：2026-10-28–29 逆向完善

之后的 [UI 细节对比与优化](ui-detail-parity-2026-10-29.md) 更新了活动、命令输出和文件控件。本文的 1,401 项测试及原生检查保留为本次工作台快照的历史结果。

本轮继续使用安装包中的实际实现和用户录屏，完善可编辑客户端的工作台状态、浏览器交互和对话处理过程。同时生成当前安装版本的本地资源复刻包；可编辑源码版和保留原 renderer 的学习包分别验证，不把二者的覆盖率混为一谈。

## 证据与版本

安装源是 `/Applications/ChatGPT.app`，产品名 Codex，版本 **26.1023.50603 / 22391**。用户录屏的 shell 是 **26.1016.61520 / 21421**，两者并非同一个构建。本轮依据录屏的具体可见状态修正布局；学习包保留当前安装版本的 renderer。

沿用用户指定的 [REA JavaScript application workflows](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md) 方法：把 ASAR 中选定的 JS/CSS 提取为惰性文件、静态分析模块与导出关系、阅读目标函数，再与离线视频抽帧核对。没有使用 clean-room 方法，也没有执行提取出来的 renderer 源码。REA 6.7 分析结果的证据 ID 为 `ev_970b5655a923bb7d23e84555788cf24d1818a199e4b98871c57e133e9582dee5`，原始结果保存在忽略目录 `reverse/raw/parity-2026-10-28/rea-evidence.json`；选定模块的路径、字节数、哈希保留在 [证据清单](../reverse/workbench-activity-evidence-2026-10-29.json)。这是一个有未解析外部依赖的选定模块分析，不代表完整应用执行图。

| 对照点 | 证据 |
| --- | --- |
| 仅思考占位 | 录屏 299.5 秒 |
| 活动标题及下方全宽分隔线 | 录屏 315 秒 |
| 最终回复开始时耗时固定，回复继续生成 | 录屏 401.5 秒 |
| 文件标签和文件导航器 | 录屏 8、134、152 秒；`panel-tabs-4cd8b7f45594.js` |
| 新标签页和浏览器工具入口 | `thread-side-panel-new-tab-2a896983c7bf.js` 及对应 CSS |
| 活动切片、最终回复与折叠边界 | `local-conversation-turn-e0fac19c5c86.js`、activity item/row 模块 |

原始源文件和包含本机聊天列表的截图只在忽略目录内使用，未加入源码交付。

## 可编辑实现

- [turnTiming.ts](../src/renderer/src/turnTiming.ts) 在首个非空 `final_answer` 到达时冻结工作耗时，保留秒/毫秒时间戳、缺失实时边界和历史终态的区分。Reducer 的后续完成通知及历史合并保留这个边界。空的 final item 和 commentary 不结束计时，迟到历史通知不使用今天的时间重新计时。
- 活动标题的分隔线放在标题下方，覆盖完整宽度；标题使用录屏中的中文时间单位，思考行使用现有 shimmer。折叠内容退出键盘焦点顺序，减少动态效果设置会关闭折叠过渡。
- [rightWorkbenchSessions.ts](../src/renderer/src/rightWorkbenchSessions.ts) 按聊天保存文件/浏览器/子智能体标签的顺序、活动标签、工作台可见状态和完整视图选择。新草稿提交后的 scope 延续终端 scope。后台页面通知及弹出标签按页面 ID 路由到所属聊天，切换聊天不会销毁浏览器页面；删除聊天才释放其原生页面。恢复另一聊天的终端状态不会抢走它保存的浏览器焦点；在当前聊天主动打开或选择终端时仍会激活终端。
- [WorkspacePane.tsx](../src/renderer/src/WorkspacePane.tsx) 保留文件过滤词、目录展开和变更面板状态。只保留实际打开的工具标签，不再因为检测到文件变更或打开某个 diff 就自动插入“变更”标签。文件面板等待当前聊天上下文与历史就绪后挂载，避免不同项目切换时短暂使用旧项目的路径和状态。文件编辑器继续使用已有的独立文档、保存、冲突及恢复机制。
- [browserViews.ts](../src/main/browserViews.ts) 和 [WorkbenchBrowser.tsx](../src/renderer/src/WorkbenchBrowser.tsx) 接入真实 Electron 页内搜索、计数、匹配导航、关闭搜索、缩放和重置，以及网页中的 macOS 地址/查找/匹配导航/新建/关闭/刷新快捷键。搜索通知按请求 ID 过滤；也处理通知早于 IPC promise 到达的情况。新的搜索或导航会失效旧请求，中文输入法组合期间的 Enter 不触发匹配跳转。首次搜索使用 Electron 44 实测要求的 `findNext: true`，后续匹配导航使用 `false`。
- 开发启动脚本支持 README 中的 `npm run dev -- --cwd=/absolute/path`，并保留其他 electron-vite 参数。

## 验证与交付

最终可编辑版通过 Node/Web 类型检查、**184 个文件中的 1,401 项测试**和 macOS arm64 应用打包。包验证器读取最终交付包，确认 **70/70 个当前构建文件逐字节一致**、配置的 Electron fuses 一致，以及 `codesign --verify --deep --strict` 成功。electron-builder 配置 `identity: null`；这里的本地签名校验不代表 OpenAI 身份。针对浏览器、计时、跨聊天状态及既有工作台布局的测试覆盖真实状态边界，不以截图文件存在作为验收成功。

原生 UI 验证只操作我们启动的 Electron 复刻客户端。实际加载本机三匹配网页后，在网页焦点中按 **⌘F**，查找框获得焦点并显示 **1/3**；**⌘G** 更新到 **2/3**。此前在独立测试聊天中验证了文件打开无额外“变更”标签、页面搜索、110% 缩放/100% 重置、切换聊天后同一原生页面及活动标签恢复。CDP 注入按键不等价于 macOS 原生键盘路径，因此原生快捷键以 Computer Use 的真实操作结果为依据。

原生 UI 工具随后报告 Mac 锁定，后续原生关闭/完整视图和更全面的流式视觉检查等待解锁；没有把未执行的检查写成通过。末轮的不同项目挂载边界、终端恢复焦点和搜索生命周期修复尚未经过新的图形验收。修订后的 `verify-workbench-parity.mjs` 也尚未取得一次完整成功报告。

当前本机没有 managed daemon rendezvous socket。实际源码版后端为 **direct**：复用安装版附带的 Codex server 二进制及现有 server home，初始化和模型读取正常。学习包另外通过 `initialize`、`getAuthStatus`、`model/list`、`thread/list` 的真实握手验证。真实模型验收通过 IPC 使用独立测试聊天，执行只读命令并检查完成状态、退出码和固定回复；它与图形验收分别记录。

真实模型测试使用 `gpt-6.1-sol`，两次命令退出码均为 0，收到 15 次最终回复 delta，并完成 turn。若要连接用户指定的既有监听实例，可设置 `CODEX_APP_SERVER_URL=ws://127.0.0.1:PORT` 或 `CODEX_APP_SERVER_SOCKET=/absolute/path/server.sock`；显式端点不会回退成私有进程。本轮 direct 模式验证不等于验证原客户端已运行的那个 server 进程。

| 本地交付 | 路径 |
| --- | --- |
| 可编辑源码版 macOS arm64 包 | `release/mac-arm64/Codex.app` |
| 保留当前原始 renderer 的学习包 | `release/local-runtime/Codex Study 2026-10-29.app` |
| 学习包完整本地校验报告 | `release/local-runtime/Codex Study 2026-10-29.reconstruction/report.json` |

学习包 **21,459 个 renderer 文件逐字节一致**；共有 22,433 个未改变的 ASAR 文件。只改动独立桌面 profile/CLI 路由、日志目录、协议注册和本地签名/完整性元数据。原安装目录保持未修改；原 fuses 和未修改的独立 helper 签名得到保留，最终包通过 deep/strict codesign 校验。

## 尚未达到完整一致的部分

可编辑版仍没有完成浏览器资料导入、扩展管理、浏览器标签跨应用重启恢复、全部嵌入式工具，以及所有侧边聊天和窗口生命周期的复刻。当前内存中的工作台会话与文件导航状态缓存不能代替这些持久化能力。尚未完成逐像素、多尺寸、动态状态的完整验收。

学习包保留原 UI 实现，但本地签名无法复制 OpenAI Team 身份、DeviceCheck、APNs 和签名绑定的原生授权能力；因此 renderer 文件一致不能证明所有服务和原生功能一致。本轮不宣称“完整/完美复刻”。
