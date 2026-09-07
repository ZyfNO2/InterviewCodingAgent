# 阶段 5 — WebUI ↔ 后端接线 (Integration，可选加分)

目标：把已完成的 CLI 版 Runtime（阶段一~三）与 Mock 版前端（阶段四）连成端到端可运行的 Web 演示，且**不改动 Agent Loop 的控制逻辑**。
定位：**接线专用文档**。文档 `04` 定义前端如何消费事件；本文定义后端如何产生事件、如何做暂停-恢复、传输层如何搭建，以及端到端联调标准。
前置条件：阶段一~三验收通过（CLI 可稳定演示）；阶段四 Mock 版前端已跑通 Case 1/2。

---

## 0. 接线原则

```text
契约不变：前后端仍只通过 AgentEvent / AgentReply 通信。
Runtime 不改控制流：只在既有节点“旁路 emit 事件”，不改 Loop 分支。
交互统一：ask_user 与 permission 复用同一套“发 ask → 等 reply”暂停-恢复。
可回退：接线失败则 web/ 分支不合并，CLI 主线不受影响。
```

契约来源：`Plan\04-Phase4-WebUI.md` A.3 的 `AgentEvent` / `AgentReply`，本文不重复定义，只引用。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] 事件出口：Runtime 侧一个 `EventSink`，Agent Loop 在关键节点向其 emit `AgentEvent`
- [ ] 交互适配：`WebInteractor` 实现统一交互接口，把 `ask` 发给前端并阻塞等待 `reply`
- [ ] 传输层：`POST /run` 启动任务，SSE（或 WS）单向下推事件，`POST /reply` 上行应答
- [ ] 会话关联：一次 `/run` 对应一个 `sessionId`，事件与应答按 `sessionId` + 事件 `id` 关联
- [ ] 前端切换：`web/transport.js` 增加 `SseEventSource`，注入点从 Mock 改为 SSE（改一行）

### A.2 后端接口契约

```text
POST /run
  req:  { task: string, workspace?: string }
  res:  { sessionId: string }               // 立即返回，事件走 SSE

GET  /events?sessionId=...                    // SSE 长连接
  data: AgentEvent（逐条推送，见 04 A.3）

POST /reply
  req:  AgentReply & { sessionId: string }    // ask_user 的 answer / permission 的 approve
  res:  { ok: true }
```

- 传输层是**契约的搬运工**：不解释、不改写事件语义。
- SSE 优先（实现更简单、单向下推天然契合事件流）；如需前端主动中断可换 WS，非必需。

### A.3 非目标

- 不做鉴权、多用户、持久化、断线重连、事件补发。
- 不做分布式/队列；单进程内存态会话即可。

---

## B. 设计（怎么做）

### B.1 Runtime 侧最小改动点

只加"旁路"，不改控制流：

```ts
interface EventSink {
  emit(e: AgentEvent): void;
}

// Agent Loop 在既有节点旁路 emit（伪代码，标注新增行）：
messages.push(userTask);
sink.emit({ type: "message", role: "user", content: task });      // +

for (step = 0; step < maxSteps; step++) {
  const res = await llm.chat(messages, tools.toLLMSchema());
  if (res.type === "final") {
    sink.emit({ type: "done", text: res.text });                   // +
    return res.text;
  }
  messages.push(assistantToolCallMsg(res.calls));
  for (const call of res.calls) {
    sink.emit({ type: "tool_call", id: call.id, name: call.name, args: parsed }); // +
    const result = await tools.execute(call, ctx);
    sink.emit({ type: "tool_result", id: call.id, name: call.name, ok: result.ok, result: result.output }); // +
    messages.push(toolResultMsg(call.id, result));
  }
}
```

- CLI 模式注入 `ConsoleEventSink`（打印），Web 模式注入 `SseEventSink`（推 SSE）。
- Loop 的 if/for 分支**一行未改**，只多了 emit。这是"接线不动核心"的关键证据。

### B.2 交互统一：ask_user / permission 暂停-恢复

```ts
interface Interactor {
  ask(kind: "ask_user" | "permission", question: string): Promise<string>;
}
```

- CLI 实现：readline 读一行返回。
- Web 实现 `WebInteractor.ask()`：
  ```text
  1) sink.emit({ type:"ask", id, kind, question })
  2) 在 sessionId+id 上挂一个 pending Promise
  3) POST /reply 到达 → 按 id resolve → 返回给调用方
  ```
- `ask_user` 工具、`PermissionService` 都调 `Interactor.ask`，不直接依赖 readline 或 HTTP。
- `permission` 的 `answer` 语义：前端回 `approve:true/false`，后端映射为放行/拒绝（拒绝时该工具返回 `ToolResult{ok:false,"user rejected"}` 回灌模型）。

### B.3 会话与生命周期

```text
POST /run
  → 建 sessionId，建 EventSink + WebInteractor + Context + Agent
  → 异步启动 agent.run()，立即回 { sessionId }
GET /events?sessionId
  → 订阅该 session 的事件流
POST /reply
  → 按 sessionId 找 WebInteractor，resolve 对应 pending
agent.run() 结束
  → emit done/error，关闭 SSE
```

- 会话表：`Map<sessionId, { sink, interactor }>`，进程内存态。
- 超时/结束清理会话，避免泄漏。

### B.4 前端侧改动（对齐 04 B.2）

```ts
// SseEventSource 实现 04 的 EventSource 接口
start(task)  → POST /run 拿 sessionId，再开 GET /events(SSE) 订阅
onEvent(cb)  → SSE onmessage → cb(JSON.parse(data))
reply(r)     → POST /reply { ...r, sessionId }
```

- `app.js` 仍只依赖 `EventSource` 接口；Mock ↔ SSE 切换只改注入那一行。

### B.5 关键取舍

- 事件是**单向下推**，应答是**独立上行**：避免 SSE 双工的复杂度。
- 不为接线提前改造 Runtime；`EventSink` / `Interactor` 是两个小接口，CLI 复用同接口的 console/readline 实现。
- 传输层与业务解耦：换 WS / 换端口 / 换协议都不动 Runtime 与前端渲染。

---

## C. 验收条件（Definition of Done）

### C.1 端到端功能

- [ ] 浏览器 `POST /run` 后，SSE 能收到有序事件并渲染，跑通 Case 1（read_file → done）。
- [ ] 跑通 Case 2（write_file → shell → done），`tool_call`/`tool_result` 按 `id` 正确配对。
- [ ] `ask_user`：前端作答 → `POST /reply` → Agent 恢复并继续。
- [ ] `permission`（危险工具）：前端 Approve/Reject 可控制工具是否执行；Reject 时结果回灌模型且流程不崩。
- [ ] Agent 结束后 `done`/`error` 正常收尾，SSE 关闭，输入框恢复。

### C.2 "核心不动"验证（最重要）

- [ ] Agent Loop 相较 CLI 版**控制分支零改动**，diff 仅为 `sink.emit(...)` 旁路与依赖注入。
- [ ] 同一个 `Agent` / `Registry` / `Tool` 实现，CLI 与 Web 两种入口共用，无逻辑分叉。
- [ ] 把注入从 Web 换回 Console/readline，CLI 版行为与阶段一~三完全一致。

### C.3 隔离与回退

- [ ] `web/` 仍不 import `src/` 内部实现，只依赖契约 + HTTP。
- [ ] 传输层（server）为独立模块；移除后 CLI 主线不受影响。
- [ ] 接线不稳定时可直接回退到 Mock 版前端演示，主线验收不受影响。

### C.4 安全

- [ ] 服务默认无鉴权，仅监听本地回环；README 明确"本地 only、勿暴露公网"。
- [ ] `workspace` 参数经与文件工具相同的路径约束校验，Web 入口不放宽越权限制。

---

## D. 与其他文档的关系

```text
04-Phase4-WebUI.md   → 前端侧契约与 Mock UI（前端唯一依赖）
06（本文）            → 后端 EventSink/Interactor + 传输层 + 端到端联调
01-Phase1            → 被复用的 Runtime 核心（本文不改其控制流）
02-Phase2            → ask_user / Permission 的交互，经 Interactor 统一到 Web
```

## E. 时间不足时的决策

```text
若时间不足 →
  1) 不接线，前端停在 Mock 版即可作为合格演示；
  2) 接线只做“单向事件下推 + Case1/2”，ask/permission 的 Web 回传可后置；
  3) 全程守住“核心不动”：宁可不接，也不动 Agent Loop 控制流。
```
