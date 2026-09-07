# 阶段四 · Step 2 — Soul.md + Prompt Assembly + /init

对应 RPDV2：§5–§10、§34 Step 2、验收 Case 3（§37）。
Commit（§45）：`feat: add soul memory and stable prompt assembly`
优先级：**P0**（Soul static injection）。
前置：Step 1（Session）已验收。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] `MemoryService` 接口 + `MarkdownMemoryService` 实现（读写 `<workspace>/.agent/SOUL.md`）
- [ ] `buildSystemPrompt({ soul, goal, plan })` —— 集中式 Prompt 组装
- [ ] `/init [content?]` 命令：Soul 不存在则创建，可带初始偏好
- [ ] 每个 Session 启动时 `loadSoul()` 并注入稳定前缀
- [ ] Agent Loop 不直接读写 Markdown 文件（经 MemoryService / prompt.ts）

### A.2 稳定前缀顺序（§3.3，硬约定）

```text
1. SYSTEM_PROMPT
2. SOUL.md（# Persistent Memory）
3. Stable Project Instructions
------------------------------ 以上为 Stable Prefix
4. Goal（本步可空）
5. Plan（本步可空）
6. Session History
7. Current User Input
```

- Stable Prefix 内**不得**混入时间、随机 runtime 信息、动态 trace、当前 step。
- 目的：保持 Prompt / KV Cache 前缀稳定。

### A.3 Soul 内容边界（§6）

| 允许（长期稳定） | 禁止（属于 Session/Trace） |
| --- | --- |
| Agent Identity | 刚刚执行 npm test |
| User Preferences（偏好 TS、偏好简洁） | README 内容 |
| Persistent Facts | 本轮 shell 输出 |
| Working Conventions（危险操作需确认） | 当前 Plan / Goal |

---

## B. 设计（怎么做）

### B.1 MemoryService（`src/core/memory.ts`）

```ts
interface MemoryService {
  loadSoul(): Promise<string>;              // 不存在返回空串
  saveSoul(content: string): Promise<void>;
  consolidate?(session: AgentSession): Promise<void>; // Step 6 才实现
}
```

- `MarkdownMemoryService`：文件锚定 `<workspace>/.agent/SOUL.md`，避免污染项目根目录。
- 目录不存在时自动创建 `.agent/`。
- 经 `ctx.provide("memory", ...)` 注入，Agent 通过 Context 取用。

### B.2 Soul 模板（§6）

```md
# Soul
## Identity
## User Preferences
## Persistent Facts
## Working Conventions
```

### B.3 Prompt Assembly（`src/agent/prompt.ts`）

- 把现有 `agent.ts` 里的 `SYSTEM_PROMPT` 迁入此处，新增动态拼接：
  ```ts
  buildSystemPrompt({ soul, goal, plan }): string
  ```
  产出：
  ```text
  SYSTEM_PROMPT

  # Persistent Memory
  {soul}

  # Current Goal
  {goal}        // 空则省略该段

  # Current Plan
  {plan}        // 空则省略该段
  ```
- Agent Loop 只调用 `buildSystemPrompt`，不碰 Markdown 解析。

### B.4 /init 处理

- 本步可先在 CLI/入口层做最小拦截（Step 3 会有正式 CommandRouter 统一收口）；
  但**推荐直接引入极简 Router 雏形**以免 Step 3 返工——由 Step 3 决定，本步至少保证 `/init` 不被当成任务丢给 LLM。
- `/init`：Soul 不存在 → 用模板创建；已存在 → 提示已存在，不覆盖。
- `/init <content>`：把 content 作为初始 User Preference 写入。

### B.5 取舍

- 不实现 Vector / 语义检索（§44）。
- Soul 是**全量注入**的稳定文本，不做检索式召回。
- Soul 可跨 Session 共享；Session history / Goal / Plan 不共享（Step 1 已定）。

---

## C. 验收条件（DoD）

### C.1 Acceptance Case 3 — Soul（§37）

```text
前置：SOUL.md 写入 "Prefer TypeScript over Python."
新 Session 输入：Create a small script.
PASS：无其他约束时 Agent 优先选择 TypeScript（证明长期偏好跨 Session 生效）。
```

### C.2 功能

- [ ] `/init` 能创建 `<workspace>/.agent/SOUL.md`；`/init <pref>` 写入初始偏好。
- [ ] Session 启动 `loadSoul()` 成功，Soul 文本进入 Stable Prefix 的 `# Persistent Memory` 段。
- [ ] Prompt 顺序严格符合 A.2；Stable Prefix 无动态信息混入。
- [ ] Goal/Plan 为空时对应段落省略，不产生空标题噪声。

### C.3 隔离与不回归

- [ ] Agent Loop 未直接出现 Markdown 文件读写。
- [ ] 原有 Permission / ask_user / Parallel / Trace / WebUI / Step 1 Session 不回归。

### C.4 Trace（§33）

- [ ] 新增 `memory_loaded` 事件（Soul 载入时）。

---

## D. 测试（§43）

- `tests/memory.test.ts`：Soul load（存在/不存在）、saveSoul、/init 创建与写入偏好。
- Prompt 组装单测：给定 soul/goal/plan，断言输出顺序与省略规则。
- 复用可注入 Mock LLM 验证"新 Session 无约束时倾向 TS"。
- 全量 `npm run build` + `npm test` 绿；原有测试不破坏。
