# Phase 4 · Step 1 — Agent Session (P0)

来源：RPDV2 §4、§30、§34.1、§35–36。commit：`feat: add persistent agent sessions`。
目标：把「一次 `run()`」与「一个 Session」分离，使连续任务共享历史，且不同 Session 相互隔离。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] 新增 `src/core/session.ts`，定义 `AgentSession`。
- [ ] `Agent.run(task)` → `Agent.run(session, task)`（或 `run({ session, task })`）；不再每次重建完整 history。
- [ ] CLI：单进程 = 单 Session，连续输入沿用同一 `session.messages`。
- [ ] WebUI：`sessionId → AgentSession`，多会话隔离。
- [ ] Trace 新增事件：`session_start`、`session_turn`。

### A.2 数据契约

```ts
export interface AgentSession {
  id: string;
  messages: ChatMessage[];
  userTurns: number;            // 用户回合数（≠ agent steps）
  goal?: AgentGoal;             // 占位，Step 3 填充
  plan?: AgentPlan;             // 占位，Step 3 填充
  progress: {                    // 占位，Step 4/5 填充
    seenResults: Set<string>;
    stallRounds: number;
    completionChecks: number;
  };
}
```

- `userTurns`：每次 `run(session, task)` 处理一个用户任务即 +1；一个 turn 内可含多次 LLM/tool step。
- `goal/plan/progress` 本步只建结构与初始化，不实现其行为（后续步骤接手）。

### A.3 run 语义

```text
create session（system prompt 只在建 session 时入一次）
  → run(session, task1)  // push user task1，Loop 推进，保留 messages
  → run(session, task2)  // 继续 append，能看到 task1 的历史
```

---

## B. 设计（怎么做）

### B.1 落点与红线

- `AgentSession` 承载 `messages/goal/plan/progress`；**Context 不新增这些字段**（红线 2）。
- `Agent` 不再内部 `const messages=[system,user]`；改为读写 `session.messages`。**system prompt 在建 session 时放入一次**，`run` 只 append user task 与后续消息。
- Agent Loop 控制分支保持不变，仅把"消息来源"从局部变量换成传入的 `session`（红线 1）。
- 复用现有 `context-manager.ts` 的截断逻辑（截断作用于进入 LLM 的消息，不改 Session 存储的完整历史与 Trace 分工）。

### B.2 Session 工厂

```ts
export function createSession(id?: string): AgentSession {
  return { id: id ?? randomId(), messages: [{ role: "system", content: SYSTEM_PROMPT }],
           userTurns: 0, progress: { seenResults: new Set(), stallRounds: 0, completionChecks: 0 } };
}
```

- CLI（`src/index.ts`）：启动建 1 个 session，主循环内每个任务 `await agent.run(session, task)`。
- Web（`src/web` 后端）：`Map<sessionId, AgentSession>`；`/api/run` 用请求带来的/新建的 sessionId 取对应 session。

### B.3 兼容

- 若保留 `run(task)` 旧签名做过渡，可内部包一层"临时 session"，但**默认路径走 `run(session, task)`**；测试以新签名为准。

---

## C. 验收条件（DoD）

### C.1 功能（对应 RPD §35–36）

- [ ] **Case 1 — Session 连续性**：先 `Create hello.ts`，再 `Now run the file you created`；第二轮无需用户重述文件名即知道是 `hello.ts`，且历史正确保留。
- [ ] **Case 2 — Session 隔离**：Session A `Create secret-a.txt`；Session B 问 `What file did I just create?`；B **不得**看到 A 的会话上下文（goal/plan/history/progress 不共享）。
- [ ] `userTurns` 按用户任务数递增，而非按 agent step。
- [ ] Trace 出现 `session_start`（建会话）与 `session_turn`（每个用户任务）。

### C.2 核心不动 / 不回归

- [ ] Agent Loop 控制分支相较之前无结构性改动，diff 主要是"messages 来源改为 session"。
- [ ] CLI 单次任务（一次性 `--task`）行为与之前一致。
- [ ] 现有 Permission / ask_user / Parallel / Trace / WebUI 测试全绿。

### C.3 测试（新增 `tests/session.test.ts`）

- [ ] 同一 session 连续两次 `run`，第二次 `messages` 含第一次的历史。
- [ ] 两个 session 的 `messages` 互不影响（含 `progress.seenResults` 是各自独立的 Set）。
- [ ] `npm run build` 无类型错误；`npm test` 全绿。
