# 会话总结：基于社区的 opencode 压缩插件

## 概述

本次会话涵盖了 `/workspaces/opencode-graph-plugin` 的完整开发生命周期，这是一个 opencode 插件，它通过 `experimental.session.compacting` 钩子提供 **社区（主题结构化）压缩**，作为 opencode 原生线性压缩的替代方案。工作流程从代码学习开始，经历了多次重构、一次完整的聚类重写、实时压缩调试（包括逆向工程打包的 opencode 二进制文件）、无头实验基础设施，以及针对合成会话和克隆真实会话的详尽配对评估。

## 关键文件与当前状态

- **`src/graph-model.ts`**: `buildGraph()` 返回 `{nodes, edges, communities, fetch: {source,count}, previousSummary?}`。获取方式 = 客户端 `limit:1000` + 规范化的 `toSessionEntry` + 时间顺序重排序 + **只读 bun:sqlite DB 后备**（当视图异常时 `<5` 条目）。边界扫描（`scanEnd`）**排除尾随的压缩标记**（opencode 在触发钩子前约 4ms 会附加该标记 —— 这是之前导致 `nodes=1` 错误的原因）。`summaryText(info,parts)` 提取先前的摘要；`modelLabel` 和 `tokenTotal` 进行了加固（处理缺失 `model`/`tokens` 的情况）。
- **`src/graph-cluster.ts`**: `assignCommunities(nodes, partsByNode, _entries?, _workspace?)`。3 个阶段：因果链（每个用户消息开启一个链），合并（精确文件重叠，`EDIT_WEIGHT=8`/`READ_WEIGHT=1`，`MERGE_SIMILARITY=0.3`，sqrt 归一化，union-find 最小 id 胜出），伴随（无文件链加入下一个/上一个社区）。标签 = 访问最多的文件，最后两个片段。
- **`src/graph-compaction.ts`**: 通过 `output.context` 导出的 `compactionContext(nodes, previousSummary?)` 返回后期覆盖块（在原生模板后连接 —— 位置胜出）。包含：角色行，“忽略上述 \<template\>” + `# TOPIC <n>: <label>` / `# STATE` 结构，规则包括货币规则（“最终轮次是最新的事实……”）、软项目符号（“目标约 5 个，超过 5 个仅在关键时使用”）、**每个主题的键值对 `blocked: none so far` 或带有确切错误的 `blocked: <reason>`**（例如 “401 Unauthorized — web_fetch …”、“tool error — bash: command not found: foo”）以及全局 “what to do next”（在所有主题之后）。回退机制：`topicsOf`（社区）→ 如果 ≤1 个主题则使用 `topicsByGaps`（10 分钟静默间隔分割，标签来自开场提示词）；如果 `<2` 个主题 → 返回 `undefined`（纯原生回退）。其他上限：`MAX_PROMPTS_PER_TOPIC=3`, `PROMPT_EXCERPT=80`, `LABEL_EXCERPT=40`, `MAX_TOPICS=12`, `MAX_FILES_PER_TOPIC=5 (+N more)`, `MAX_PRIOR_CHARS=3000`（头部 1800 + 尾部 800）。`plausibleLabel()` 保护机制拒绝垃圾标签（如 `tool-output/*`, `tool_<id>`）→ 回退到提示词；重复标签通过追加提示词来消除歧义。
- **`src/graph-plugin.ts`**: 注册工具 `session_graph_png`（仅文本输出：计数 + 保存路径）和压缩钩子；钩子将上下文推入 `output.context`；TEMP `trace()` 将数据写入 `/tmp/opencode/hook-trace.log` (`module-loaded`, `hook-enter`, `graph-built {source,entries,nodes,communities,contextChars}`, `context-pushed {chars}`, `hook-error`)。
- **`src/test_cluster.ts`**: 约 30 个针对当前 API 的检查（聚类场景 + 覆盖断言：模板修正、TOPIC/STATE 形式、map 嵌入、prior-summary 融合、间隙分割、标签冲突消除歧义、垃圾标签回退、防延续保护结束、单爆发回退）。全部通过。
- **同步规范**: `cp src/graph-model.ts src/graph-cluster.ts src/graph-compaction.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/` + 使用排除项进行 `diff -r`（Roboto-Regular.ttf, test_cluster.ts, test_graph-plugin.ts） → `SYNC OK`。类型检查从 `.opencode/` 目录运行（仅预期的错误是 graph-render.ts 中的 `import.meta.dir`）。AGENTS.md 的同步命令仍列出了旧的 4 个文件 —— 更新推迟到项目收尾阶段。

## 已发现/验证的 opencode 内部原理（二进制逆向工程）

- 压缩组装：`to = Ve.prompt ?? [qh({previousSummary:D, context:[ze]}), ...Ve.context].join("\n\n")`; 最终文本 = `[to, ...(Ve.prompt ? ["The following is the conversation history:", ze] : [])]`。原生路径有效是因为它是历史在前/指令在后；设置 `output.prompt` 会将指令放在原始历史记录之前 -> 导致模型继续对话（15:05 失败：5198 字符的转录重放）。**修复方案：使用 `output.context`（最后连接，在模板之后）。**
- 原生模板强制执行：“输出 \<template\> 内显示的准确 Markdown 结构并保持章节顺序不变” —— 这就是为什么单纯的追加会失败；我们的覆盖块明确对其进行了修改。
- 原生序列化器：`[User]:/[Assistant]:/[Assistant reasoning]:/[Assistant tool call]: name(input)/[Tool result]:` 截断至 2000 字符；融合常量（携带目标/约束/指令/并行工作流；对话在冲突中胜出）；压缩代理的系统防护（“不要继续对话……”）存在于二进制文件中，但不在手动路径上（那里是 `system: []`）。
- 钩子：`experimental.chat.messages.transform` 仅在序列化前触发（正常聊天站点 + 压缩头部站点）；系统变换不适用于压缩；自动压缩路径 (`compactAfterOverflow`) **不会**触发压缩钩子（上游限制 —— 手动 `/compact` 才会触发）。
- 插件加载器会将 `plugins/` 中的每个 `.ts` 文件视为入口点 -> 库模块会产生外观上的加载错误（无害的噪音）。
- 手动压缩 = `POST /session/{id}/summarize {"providerID":"opencode","modelID":"x-preview-f-free"}`；TUI 的 `/compact `（带尾部空格）会被当作聊天文本