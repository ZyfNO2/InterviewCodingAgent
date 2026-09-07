# Phase 4 前端总览 — WebUI 对 Runtime Policy 的可视化（Mock 优先，可并行）

配套后端：`08-Phase4-Overview.md` 及其 6 个步骤（Session / Soul / Plan-Goal / Completion / Progress / Memory）。
本组文档把 Phase 4 的**前端需求**拆成可独立并行、Mock 先行的 Spec，编号接在后端文档之后。

定位（一句话）：Phase 4 引入的每个新 Runtime 能力（连续会话、Soul、Plan 审批、Completion 驳回、Stall 早停、Memory 沉淀）
都需要在 WebUI 上有**对应的事件与 UI 表现**；前端先用扩展后的 Mock 剧本把这些形态做完，接线是后置加分项。

---

## 0. 并行开发前提（与后端解耦）

```text
前端只依赖“事件契约”，不依赖 Runtime 内部结构。
Phase 4 在现有 AgentEvent / AgentReply 基础上“增量扩展”，不推翻旧契约。
先用 Mock 剧本驱动全部新 UI，再谈接线（接线走 06 的 SSE 通道，本组不重复）。
```

因此本组每份 Spec 都要求：**先给出扩展契约 → 再给 Mock 剧本 → 再给 UI 渲染 → 最后给验收**。
接不上真后端时，`web/` 停在 Mock 版即可作为合格演示。

---

## 1. 现有前端基线（已实现，勿重造）

代码事实（`web/`）：
- `transport.js`：`AgentEvent`/`AgentReply` 契约（JSDoc）、`BaseEventSource`、`MockEventSource`（剧本回放 + `ask` 暂停等 `reply`）、`SseEventSource`。
- `app.js`：`WebApp` 类，`handleEvent` 分发 6 类事件（`message/tool_call/tool_result/ask/done/error`），`tool_call`↔`tool_result` 按 `id` 配对，`ask` 内联表单（permission=Approve/Reject，ask_user=输入框）。
- `index.html`：深色 UI、顶部模式/剧本切换、状态徽章、底部输入栏、全部样式内联。
- `mock.js`：`mockScenarios` = case1/case2/case3 三个剧本函数。

**基线约束**：新增事件类型走 `handleEvent` 的 `switch` 增量分支；新增剧本加进 `mockScenarios`；样式沿用 `index.html` 既有 CSS 变量与卡片风格。不重写 `WebApp` 架构。

---

## 2. 文档索引（与后端步骤对应）

| 前端文档 | 对应后端步骤 | 主题 | 优先级 |
| --- | --- | --- | --- |
| `16-Phase4-Frontend-Session.md` | Step 1 Session | 会话切换 / 连续对话 / 会话隔离的可视化 | P0 |
| `17-Phase4-Frontend-Soul-Command.md` | Step 2 Soul + Step 3 命令入口 | `/init`、`/plan` 命令输入体验 + Soul 面板 | P0 |
| `18-Phase4-Frontend-Plan-Approval.md` | Step 3 Plan-Goal | Goal/Plan 展示卡 + 审批 Gate（approve/reject/revise） | P0 |
| `19-Phase4-Frontend-Runtime-Status.md` | Step 4/5 Completion + Progress | 完成校验、Stall 警告、Early Stop、stopReason 的状态提示 | P1 |

说明：Step 6（Memory Consolidation）前端仅需一个"记忆已更新"轻提示，并入 `19` 的运行时状态一并处理，不单列文档。

---

## 3. 前端事件契约增量（Phase 4 统一登记）

在现有 `AgentEvent` 联合类型上**新增**以下成员（各文档只引用，不重复定义）：

```ts
// —— Session（Step1）——
| { type: "session"; sessionId: string; userTurns: number }        // 会话开始/切换时下发

// —— Soul / Command（Step2）——
| { type: "soul"; action: "loaded" | "updated"; summary: string }  // Soul 载入或写入
| { type: "command"; command: "init" | "plan"; accepted: boolean; note?: string }

// —— Plan / Goal（Step3）——
| { type: "goal"; description: string; acceptanceCriteria: string[] }
| { type: "plan"; steps: string[]; risks?: string[]; status: "proposed" | "approved" | "rejected" | "revised" }

// —— Completion（Step4）——
| { type: "completion_check"; complete: boolean; reason?: string; remaining?: string[]; attempt: number }

// —— Progress / Early Stop（Step5）——
| { type: "stall_warning"; round: number }
| { type: "early_stop"; stopReason: "stalled" | "completion_check_limit" | "max_steps"; detail?: string }
```

对应 `AgentReply` 新增（Plan 审批复用 ask 的回传通道，也可独立）：

```ts
| { type: "plan_decision"; id: string; decision: "approve" | "reject" | "revise"; note?: string }
```

命名与后端 Trace 事件（RPD §33：`session_start/plan_generated/completion_check/stall_warning/early_stop...`）保持语义一致，便于接线时一一映射。

---

## 4. 全组前端红线

1. **增量不推翻**：旧 6 类事件与 case1/2/3 剧本保持可用，不回归。
2. **Mock 先行**：每个新形态必须有 Mock 剧本能独立回放，不依赖后端。
3. **契约唯一依赖**：`app.js` 只认事件类型，不 import `src/`。
4. **未知事件不崩**：`handleEvent` 对未识别 `type` 静默忽略（或降级为一行灰字），保证向前兼容。
5. **风格统一**：沿用 `index.html` 既有 CSS 变量（`--accent-*`）与 `.event-card` 卡片结构。
6. **可回退**：接线失败时 Mock 版即合格演示；不为接线阻塞前端交付。

---

## 5. 交付顺序建议

```text
16（Session 可视化）→ 17（命令入口 + Soul 面板）→ 18（Plan 审批）→ 19（运行时状态）
```

与后端步骤同序即可；但因为都是 Mock 优先，四份可由一人并行滚动推进，互不阻塞。
