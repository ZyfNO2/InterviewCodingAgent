# Phase 4 总览 — Runtime Policy（Session / Soul / Plan & Goal / Completion / Progress）

来源：`Plan\RPDV2.MD`。本组文档把 RPDV2 拆成 6 个可独立交付、可独立验收的步骤，每步一个 Spec 文件。

定位（一句话）：在现有 **Minimal Agent Runtime** 上外挂一层 **Lightweight Runtime Policy**，得到
`Execution + Session + Memory + Planning + Human Gate + Completion + Progress Control`，
但 **Agent Loop 仍保持简单**，控制能力尽量由外围 Service / Policy 提供。

---

## 文档索引（实施顺序 = 验收顺序 = commit 顺序）

| 步骤 | 文档 | 对应 RPD 章节 | 优先级 | commit |
| --- | --- | --- | --- | --- |
| Step 1 | `09-Phase4-Step1-Session.md` | §4、§34.1、§35–36 | P0 | feat: add persistent agent sessions |
| Step 2 | `10-Phase4-Step2-Soul-Prompt.md` | §5–10、§34.2、§37 | P0（沉淀部分 P2） | feat: add soul memory and stable prompt assembly |
| Step 3 | `11-Phase4-Step3-Plan-Goal.md` | §11–18、§34.3、§38–39 | P0 | feat: add plan mode with goal and approval gate |
| Step 4 | `12-Phase4-Step4-Completion-Gate.md` | §19–23、§34.4、§40 | P1 | feat: add completion verification |
| Step 5 | `13-Phase4-Step5-Progress-EarlyStop.md` | §24–28、§34.5、§41 | P1 | feat: add progress tracking and early stop |
| Step 6 | `14-Phase4-Step6-Memory-Consolidation.md` | §9、§34.6、§42 | P2 | feat: add periodic soul consolidation |

优先级收敛（RPD §46）：**做到 P1（Step 5）即可停**；Step 6（10-turn 记忆沉淀）可写进 README 的 Future Work，不阻塞前五步验收。

---

## 当前 Runtime 基线（已实现，勿重造）

代码事实：`Agent Loop`、`Context`(DI)、`ToolRegistry`、`read/write/shell/ask_user`、`Permission`、
`Parallel（executeBatch）`、`JSONL Trace`（`src/core/trace.ts`）、`Tool Result 截断`（`src/core/context-manager.ts`）、`CLI`、`WebUI/SSE`。

关键待改点：`Agent.run(task)` 每次新建 `messages=[system,user]` → 连续输入 **不是** 连续 Session。Step 1 首先修正。

---

## 全阶段设计红线（每个 Step 都必须遵守）

1. **Agent Loop 保持简单**：Session/Memory/Plan/Goal/Progress/Command 解析 **不直接写进 `agent.ts`**；Loop 仍只做 `LLM → Tool Calls → Tool Results → 状态推进 → Final`。
2. **Context 仍是 DI 容器**：`ctx.provide/resolve` 注入 `llm/tools/permission/memory/session...`；但 `messages/goal/plan/memoryFacts` **不作为 Context 字段**，它们属于 `AgentSession`。
3. **Stable Prefix 优先**：Prompt 顺序固定为
   `SYSTEM_PROMPT → SOUL → Stable Project Instructions ──── Goal → Plan → Session History → Current Input`；
   稳定内容前置，**不在前部放时间/随机/step/动态 trace**（利于 KV Cache 稳定）。
4. **Human Gate 是 Runtime Gate，不是 LLM 自觉**：Plan 审批、Permission 由 Runtime 强制，不能实现成"让 LLM 自己决定何时 ask_user"。
5. **Trace = 完整事实，Context = 模型当下所需**：新增事件写 Trace；沉淀/截断都遵循此分工。
6. **不回归**：现有 Permission / ask_user / Parallel / Trace / WebUI / CLI 行为不得破坏。
7. **不过度拆分**（RPD §32/§44 Non-Goals）：不做 Vector/RAG/Multi-Agent/复杂 Planner Graph/DB 持久化/Token 级压缩/Factory 套娃。

---

## 最终目标文件结构（RPD §32）

```text
src/
├── agent/  { agent.ts, prompt.ts, types.ts }
├── core/   { context.ts, context-manager.ts, session.ts, memory.ts,
│            command-router.ts, planner.ts, progress.ts, permission.ts, trace.ts }
├── tools/  llm/  cli/  web/
```

## 新增 Trace 事件（RPD §33，跨步骤逐步补齐）

```text
session_start / session_turn
plan_start / plan_generated / plan_approved / plan_rejected
memory_loaded / memory_consolidated
completion_check / completion_rejected
stall_warning / early_stop
```

## 本阶段完成定义（RPD §47，最小达成）

```text
✓ 连续任务共享 Session      ✓ 不同 Session 隔离
✓ SOUL.md 可初始化并进入稳定 Context Prefix
✓ /plan 生成 Goal + Plan    ✓ 批准前无副作用执行 / 批准后按 Plan 执行
✓ 模型 Final 可被 Completion Gate 驳回
✓ 停滞时收到重规划提示并最终 early stop
✓ maxSteps 仍为最终硬限制   ✓ 原有能力不回归
```
