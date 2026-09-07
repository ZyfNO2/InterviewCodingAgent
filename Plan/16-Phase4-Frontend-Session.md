# Phase 4 前端 · Step 1 — Session（会话）

对应后端：`09-Phase4-Step1-Session.md`。契约来源：`web/transport.js`（`AgentEvent` / `AgentReply`）。
定位：前端可**并行**开发，全部先用 Mock 跑通；接线只需把注入切到 `SseEventSource`。

---

## A. SPEC（做什么）

### A.1 契约扩展（前后端唯一约定）

`web/transport.js` 的 `AgentEvent` 增加两类事件（后端 Step 1 会发；Mock 先造）：

```ts
| { type: "session_start"; sessionId: string; title?: string }
| { type: "session_turn"; sessionId: string; turn: number }   // 第几个 user turn
```

其余事件（message/tool_call/tool_result/ask/done/error）**形状不变**。

### A.2 交付清单

- [ ] 会话侧栏（或顶部会话条）：展示当前 `sessionId` 与已进行的 `turn` 数
- [ ] 「新建会话」按钮：清空事件流并开启一个新 sessionId（Mock 下本地生成）
- [ ] 连续任务不清屏：同一 session 内多次发送任务，事件**累加**在同一会话视图
- [ ] 会话隔离可视化：切换/新建会话后，旧会话的消息不出现在新会话视图
- [ ] Mock 剧本覆盖：Case 1（连续两轮，第二轮引用第一轮产物）与 Case 2（两个隔离会话）

### A.3 非目标

- 不做会话持久化到 localStorage/IndexedDB（本地演示，刷新即重置即可）。
- 不做多标签同步、不做会话重命名的复杂交互。

---

## B. 设计（怎么做）

### B.1 现有代码接入点

- `app.js` 目前每次 `sendTask()` 不清屏、事件持续 append，已天然支持"连续任务累加"。
- 需要新增：`currentSessionId` 状态 + 会话条 DOM + `handleEvent` 增加 `session_start`/`session_turn` 分支。
- 「清屏」按钮语义保持（清当前视图）；新增「新建会话」= 清视图 + 换 sessionId + `toolCallCards.clear()`。

### B.2 Mock 侧（`mock.js` + `MockEventSource`）

- 新增剧本 `session_case1`：
  ```text
  turn1: session_start → message(user:create hello.ts) → tool_call(write_file) → tool_result → done
  turn2: session_turn(2) → message(user:run the file you created)
         → assistant 明确引用 hello.ts → tool_call(shell node hello.ts) → tool_result → done
  ```
  第二轮**不重新询问文件名**，证明 Session 记忆（对应 RPD Acceptance Case 1）。
- 新增剧本 `session_iso`（隔离演示）：提供"会话 A 建 secret-a.txt"和"会话 B 问刚建了什么"两段；
  UI 在切到会话 B 后不应看到 A 的历史（对应 RPD Acceptance Case 2）。
- `MockEventSource` 增加 `startSession()/newSession()` 或用事件里带的 `sessionId` 驱动即可，保持最小改动。

### B.3 渲染映射（新增）

| 事件 | UI 表现 |
| --- | --- |
| `session_start` | 会话条显示 sessionId（短 id）+ 状态置为 "Session active"，可选插入一条分隔标记 |
| `session_turn` | 会话条 turn 计数 +1；可在事件流插入细分隔线「Turn N」 |

### B.4 取舍

- Session 状态只存前端内存；接真后端时 sessionId 由后端 `session_start` 提供，前端照用。
- 不动既有六类事件的渲染函数，只加分支与一个会话条组件。

---

## C. 验收条件（Mock 优先）

- [ ] 同一会话连续发两个任务，事件累加、不清屏，会话条 turn 从 1 → 2。
- [ ] `session_case1` 第二轮 UI 明确体现"引用上一轮 hello.ts"，无二次询问文件名。
- [ ] 「新建会话」后视图清空、sessionId 变化、`toolCallCards` 清空，旧会话内容不残留。
- [ ] `session_iso` 演示中，会话 B 视图不含会话 A 的消息。
- [ ] 未接后端也可完整演示；切到 `SseEventSource` 后 `session_start/turn` 能正常渲染（联调阶段验证）。

## D. 与后端接线

- 契约新增的两事件由后端 Step 1 在 `session_start`/每个 user turn 发出；前端只消费。
- 切源仅改 `app.js` 注入那一行；`web/` 不 import `src/` 内部实现。
