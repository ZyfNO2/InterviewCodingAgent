# 阶段扩展设计 — 工具并发 与 Context 管理

本文汇总两个进阶工程特性的设计：**工具并发（有限并发执行池）** 与 **Context 管理**。
定位：这是 Phase 2 之后的进阶设计文档，不是必做项。它记录"当前已实现到哪一步"和"下一步怎么演进"，供 Review 与面试讲解使用。

> 关键取舍（先说结论）：
> - **并发**：值得纳入 Phase 2/后续的工程特性；当前已实现"连续 parallelSafe 分组并行"，下一步是**有限并发池 + parallel/exclusive barrier**。
> - **Memory**：**收敛成 Context Management，不扩张成长期记忆系统**（不做 memory.json / 向量库 / RAG / 跨 Session）。

---

## 当前已实现基线（Phase 2 现状，避免重复造轮子）

代码事实（来自 `src/tools/registry.ts` / `src/agent/agent.ts`）：

- `Tool` 已有 `risk: "safe" | "dangerous"` 与 `parallelSafe: boolean`。
- `ToolRegistry.executeBatch(calls, ctx)`：把**连续的** `parallelSafe` 工具分组 `Promise.all` 并行，其余逐个 `await`；结果**严格按原 call 顺序**返回。
- `ToolRegistry.batchStats(...)`：统计并行组/顺序数，供事件渲染展示"并行发起"。
- Permission 在 `execute` 内逐个检查；危险工具本就 `parallelSafe:false`。
- `Agent.run` 直接维护 `messages[]`，**无预算/截断/压缩**。

因此本文的"设计"部分 = 在此基线上的**增量演进**，不推翻现有结构。

---

# 一、工具并发 / 有限并发执行池设计

准确叫法：**有限并发执行池（bounded concurrency pool）**。Node.js 下多数 Tool 是文件 I/O、HTTP、子进程等待，不需要真的 `Worker Thread`。

## A. SPEC（做什么）

### A.1 目标链路

```text
LLM → 多个 Tool Calls → ToolExecutor/Scheduler
   → 判断执行模式 (parallel | exclusive)
   → 有限并发执行 → 结果 Buffer
   → 按原 Tool Call 顺序提交 → Context/Trace → 下一轮 LLM
```

### A.2 核心原则

1. **执行顺序 ≠ 提交顺序（Execution Order ≠ Commit Order）**
   并行执行允许乱序完成，但回灌模型时必须按原 call 下标顺序，保证 Context/Trace 稳定。
   *（当前 `executeBatch` 已满足此原则。）*

2. **Tool 分 parallel / exclusive**
   - 现状用 `parallelSafe: boolean` 表达。
   - 演进：可选引入更显式的 `ExecutionMode = "parallel" | "exclusive"` 或 `isConcurrencySafe(args)`（按参数动态判断，如 shell 的只读命令可视为 parallel）。
   - `exclusive` 工具形成 **Barrier**：其前后的 parallel 批次被隔离，独占执行。

   | 工具 | 模式 |
   | --- | --- |
   | `read_file` / `grep` / `search` | parallel |
   | `write_file` / `git commit` / 危险 shell | exclusive |

3. **不使用无限 `Promise.all`**
   引入并发上限 `maxConcurrency`（3/4/8），用 semaphore 或 `p-limit`，防止：大量文件操作、API 打爆、子进程过多、资源竞争、Permission/Trace 难治理。

4. **层级划分（Phase 1 已写好则不提前重构，做并行时再抽 `ToolExecutor`）**

   ```text
   AgentLoop → ToolExecutor/Scheduler → ToolRegistry → Permission → Tool.execute()
   ```

   | 模块 | 职责 |
   | --- | --- |
   | AgentLoop | 模型调用、推进 Step |
   | ToolExecutor | 并发池、parallel/exclusive、结果顺序 |
   | ToolRegistry | 找 Tool、schema、注册 |
   | Permission | 是否允许执行 |
   | Tool | 真正执行动作 |

## B. 设计（怎么做，增量）

### B.1 与现有 `executeBatch` 的关系

- **不新建控制层，先增强现有分组逻辑**：在每个 parallel 分组的 `Promise.all` 外套一个并发限制器（semaphore/p-limit），把"分组内无限并行"变为"分组内至多 `maxConcurrency` 并行"。
- exclusive（`parallelSafe:false`）保持逐个 `await`，天然是 barrier，无需额外代码。
- 仅当逻辑变复杂（动态模式判断、跨批次调度、优先级）时，才把执行逻辑从 `ToolRegistry` 抽到独立 `ToolExecutor`，`AgentLoop` 与 `Registry` 接口不变。

### B.2 最小实现建议

```ts
// core 或 tools 下新增一个 semaphore；不引重依赖
const limit = createLimiter(ctx.config.maxConcurrency ?? 4);
const groupResults = await Promise.all(
  group.map((call) => limit(() => this.execute(call, ctx))),
);
```

### B.3 配置

- `maxConcurrency`（默认 4）通过 `AgentConfig` 注入，CLI `--max-concurrency` 可覆盖。

### B.4 取舍

- 结果顺序语义**不变**（复用现有 `results[i]` 定位）。
- Permission 仍逐个进行（危险工具非 parallelSafe，不进并行组）。
- 不做优先级队列 / 抢占 / Worker Thread —— 笔试规模不需要。

## C. 验收条件

- [ ] 一批 N 个 `read_file`（N > maxConcurrency）时，同时在跑的不超过 `maxConcurrency` 个。
- [ ] 结果仍严格按原 call 顺序回灌（乱序完成不影响提交顺序）。
- [ ] 含 `write_file` / `shell` 的批次不发生错误并行（barrier 生效）。
- [ ] `AgentLoop` 源码相较之前无结构性改动；并发逻辑集中在 executor/registry 一处。
- [ ] `maxConcurrency` 可通过配置/CLI 调整并生效。

---

# 二、Memory / Context 管理设计

现状：Agent 只有**单次 Run 内的 Message History**（`messages.push(...)`），没有跨 Session / 持久化 / 向量 / RAG Memory。**本次不实现长期 Memory**，只做 Context Management。

## A. SPEC（做什么）

### A.1 引入 ContextManager

```text
AgentLoop → ContextManager → Message History
```

```ts
interface ContextManager {
  append(message: ChatMessage): void;
  getMessages(): ChatMessage[];
  compact(): Promise<void>;
}
```

解决核心问题：**Agent Loop 跑长后 Context 无限增长怎么办？**

### A.2 ContextManager 管四件事

1. **Message History**：维护 system/user/assistant/tool_call/tool_result，保证 **tool_call 与 tool_result 配对不被破坏**。
2. **Context Budget**：设 `maxContextTokens`（如 32k）；接近阈值触发压缩。
3. **Tool Result 截断**：Coding Agent 最易撑爆 Context 的是 shell 大输出 / 大文件 / 测试日志 / grep 海量结果。
   - 策略：**完整结果 → Trace/artifact，截断结果 → LLM Context**。
   - 即 **Trace 保存事实，Context 保存模型当前需要的信息**。
4. **历史压缩**：
   ```text
   保留：System Prompt / 任务目标 / 最近 N 轮 / 关键 Tool Result
   压缩：更早的过程 → Summary
   ```
   避免粗暴 `slice(-10)` 把 tool_call 留下、对应 tool_result 剪掉，破坏配对。

## B. 设计（怎么做）

### B.1 落点

- 新增 `core/context-manager.ts`，`Agent` 用它替代裸 `messages[]`（`append` / `getMessages`）。
- `Agent.run` 每轮 `chat` 前调用 `getMessages()`；每次 push 改为 `append()`。**Agent Loop 控制逻辑不变**。

### B.2 截断与 Trace 协作

- Tool 结果先写完整版到 Trace（已有 `src/core/trace.ts`），再写一个截断/摘要版进入 Context。
- 截断保留头尾 + 标注"已截断 X 行，完整见 trace"。

### B.3 压缩触发

- `compact()` 在预算超阈值时调用：对"最近 N 轮之前"的消息做摘要（可先用规则摘要，有 LLM 预算再用模型摘要），压缩时**成对处理 tool_call/tool_result**。

### B.4 取舍

- 先做**截断 + 预算检查**（低成本、收益最大），压缩（尤其 LLM 摘要）作为可选增强。
- 不做持久化、跨 Session、用户画像、向量检索 —— 明确不在范围内。

## C. 验收条件

- [ ] 单个超大 tool 结果（如 shell 输出上万行）进入 Context 时被截断，完整内容可在 Trace 中找到。
- [ ] 压缩/裁剪后，历史中不存在"落单"的 tool_call（无对应 tool_result）或反之。
- [ ] 长循环（多轮）下 Context token 不无限增长，稳定在预算附近。
- [ ] `Agent.run` 控制流程相较之前无结构性改动，仅数据存取改走 ContextManager。
- [ ] 关闭/未启用 ContextManager 时，行为回退为原始 messages 逻辑（可开关）。

---

# 三、整体演进图

```text
                     AgentLoop
                         │
            ┌────────────┴────────────┐
            ↓                         ↓
      ContextManager              ToolExecutor
            │                         │
       Token Budget             Concurrency Pool
       Message History          Parallel / Exclusive
       Compaction               Ordered Commit
            │                         │
            │                    ToolRegistry
            │                         │
            └──────────┬──────────────┘
                       ↓
                     Trace
```

两者分别解决 Harness 的两个典型问题：

```text
Tool Concurrency → Agent 如何高效、安全地执行多个 Action
Context/Memory   → Agent 如何长时间运行而不把上下文撑爆
```

---

# 四、优先级（对本次笔试）

```text
Phase 1  Agent Loop + read/write/shell → COMMIT
Phase 2  Permission + ask_user
         → Parallel Tool Execution（现状：连续 parallelSafe 分组；进阶：有限并发池 + barrier）
         → Context Manager（有时间再做）
         → Persistent Memory（不建议本次做）
```

结论：**并发是值得加入的工程特性；Memory 收敛为 Context Management，不扩张为长期记忆系统。**
