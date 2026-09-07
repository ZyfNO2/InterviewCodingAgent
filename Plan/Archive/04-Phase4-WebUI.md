# 阶段四 — 前端 WebUI (P2，独立并行开发)

目标：为 Agent Runtime 提供一个最小 Web 交互层用于演示，**先基于 Mock 契约独立开发**，最后再决定是否接真 Runtime。
定位：**可选、可并行、可丢弃**。它在独立目录 `web/` 里开发，不碰 Runtime 核心；即使接不上真后端，也不影响笔试主线。

前置条件：无（前端可与阶段一~三并行）。真正接线只在阶段一~三验收通过后进行。

---

## 0. 开发策略：Contract-First / Mock 优先

关键决策（回应架构讨论）：

```text
前端不依赖 Runtime 内部结构。
前端只依赖一份事件契约 AgentEvent。
先用 Mock 数据把 UI 全部做完，再谈接线。
```

好处：

- 前后端完全解耦，可并行，互不阻塞。
- 接线失败时，`web/` 分支不合并即可，主线不受影响。
- 面试时能讲清"契约驱动 + 适配器"的工程思路。

---

## A. SPEC（做什么）

### A.1 交付清单（Mock 阶段，必做）

- [ ] 独立目录 `web/`，单页应用（静态 HTML + 原生 JS 即可，无需构建）
- [ ] 任务输入框 + 发送按钮
- [ ] 事件流渲染区，按 `AgentEvent` 类型分卡片展示
- [ ] 一个 Mock 事件源（本地 JS 生成/回放事件序列），驱动整套 UI
- [ ] 覆盖 Case 1 / Case 2 的完整 Mock 剧本（read_file / write_file / shell）

### A.2 交付清单（接线阶段，可选）

- [ ] 后端 `/run` 接口 + SSE/WS 事件推送
- [ ] Runtime 侧发出 `AgentEvent`（emitter → 传输层）
- [ ] ask_user / 危险工具审批的 Web 回传通道

### A.3 事件契约（前后端唯一约定）

```ts
type AgentEvent =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result: string }
  | { type: "ask"; id: string; kind: "ask_user" | "permission"; question: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

// 前端 → 后端（仅接线阶段）：对 ask 的应答
type AgentReply =
  | { type: "answer"; id: string; value: string }        // ask_user 的回答
  | { type: "approve"; id: string; approved: boolean };  // permission 的批准/拒绝
```

- `id` 用于把 `tool_result` 对应回 `tool_call`、把 `answer/approve` 对应回 `ask`。
- 该契约是前端唯一依赖；Runtime 如何产生事件，前端不关心。

### A.4 非目标

- 不做账号、多会话持久化、复杂前端框架、构建工具链、部署。
- 不追求视觉精致，够演示即可。

---

## B. 设计（怎么做）

### B.1 目录（与 Runtime 隔离）

```text
web/
├── index.html          # 结构 + 样式（最小）
├── app.js              # 渲染 + 事件消费 + 交互
├── mock.js             # Mock 事件源（Case1/Case2 剧本）
└── transport.js        # 事件源抽象：mock | sse，二选一注入
```

`web/` 与 `src/`（Runtime）物理隔离，避免任何耦合。

### B.2 传输抽象（Mock 与真后端同形）

```ts
interface EventSource {
  start(task: string): void;
  onEvent(cb: (e: AgentEvent) => void): void;
  reply(r: AgentReply): void;   // 回答 ask / 审批；Mock 里可本地消化
}
```

- `MockEventSource`：读 `mock.js` 剧本，按节奏 `setTimeout` 吐事件；遇到 `ask` 事件时等待 `reply` 再继续。
- `SseEventSource`：接后端 `/run`（SSE 收事件，`POST /reply` 回传）。
- `app.js` 只依赖 `EventSource` 接口，切换 Mock/真后端只改一行注入。

### B.3 UI 渲染映射

| 事件 | UI 表现 |
| --- | --- |
| `message`(user) | 右侧用户气泡 |
| `message`(assistant) | 左侧助手气泡 |
| `tool_call` | 工具调用卡片（名称 + 参数摘要 + loading） |
| `tool_result` | 结果卡片（ok 绿 / 失败红，可折叠长文本），按 `id` 关联到对应调用卡片 |
| `ask` | 内联表单：`ask_user` 显示输入框；`permission` 显示 Approve / Reject 按钮 |
| `done` | 最终答案高亮块，输入框恢复可用 |
| `error` | 错误提示条 |

### B.4 与 Runtime 的接线设计（接线阶段才做）

```text
AgentLoop / Registry
   → 产出 AgentEvent（emitter）
   → 传输层 SSE/WS
   → 前端 EventSource
```

- Runtime 侧只需增加一个事件发射点（不改控制逻辑）：Agent Loop 在"发起 tool_call / 收到 tool_result / 最终答案"处 emit 事件。
- ask_user / permission 走"发 `ask` → 等 `reply`"的暂停-恢复，与 CLI readline 平行，是同一交互层的另一实现。
- 若 Runtime 侧接线成本偏高或不稳定：**`web/` 分支不合并**，用 Mock 版演示即可。

### B.5 关键取舍

- 不为"未来接后端"提前改造 Runtime；接线时再加最小 emitter。
- 前端一切以 Mock 跑通为第一里程碑，接线是加分项而非阻塞项。
- 安全：后端接口默认无鉴权，仅限本地；README 明确"本地 only、勿暴露公网"。

---

## C. 验收条件（Definition of Done）

### C.1 Mock 阶段（必达）

- [ ] `web/index.html` 本地打开即可运行，无需构建、无需后端。
- [ ] 输入任务后，Mock 事件源能完整回放 Case 1（read_file → assistant 总结）。
- [ ] 能完整回放 Case 2（write_file → shell → done）。
- [ ] `tool_call` 与对应 `tool_result` 通过 `id` 正确配对渲染。
- [ ] `ask` 事件能在 UI 上作答/审批，Mock 收到 `reply` 后继续吐后续事件。
- [ ] `error` 事件有可见提示，不导致页面卡死。

### C.2 接线阶段（可选加分）

- [ ] 浏览器输入任务能经真后端跑通 Case 1 / Case 2。
- [ ] Runtime 核心（Agent Loop / Registry / Tool）相较 CLI 版无逻辑分叉，仅新增事件发射与传输适配。
- [ ] ask_user / 危险工具审批可在网页作答并恢复。
- [ ] README 增补 Web 启动方式与"本地 only"安全说明。

### C.3 隔离性

- [ ] `web/` 不 import `src/` 内部实现；仅依赖 `AgentEvent` / `AgentReply` 契约。
- [ ] 删除或不合并 `web/` 时，CLI 主线功能与验收不受任何影响。

---

## D. 时间不足时的决策

```text
若时间不足 →
  1) 优先保证 CLI 主线：Agent Loop + DI + Registry + Permission + ask_user 完整可演示；
  2) 前端只交付 Mock 版（不接后端）也算合格演示；
  3) 接线是加分项，接不上就不合并 web/ 分支。
```
