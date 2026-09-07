# 阶段四 · Step 3 — Command Router + /plan + Planner + Goal + Approval Gate

对应 RPDV2：§11–§18、§34 Step 3、验收 Case 4（§38）、Case 5（§39）。
Commit（§45）：`feat: add plan mode with goal and approval gate`
优先级：**P0**（/plan、Goal、Approval Gate）。
前置：Step 1（Session）、Step 2（Soul/Prompt）已验收。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] `CommandRouter`：CLI 与 Web 统一入口，解析 `/plan` `/init` 与普通 task
- [ ] `Planner`：Plan 模式下调查仓库并生成 Goal + Plan + Acceptance Criteria + Risks
- [ ] `AgentGoal` / `AgentPlan` 类型，写入 `session.goal` / `session.plan`
- [ ] **Approval Gate**：Plan 生成后需 approve / reject / revise，未批准禁止副作用工具
- [ ] Plan 阶段工具权限收紧：只读，不写

### A.2 命令契约（§12）

```ts
type UserCommand =
  | { type: "task"; task: string }
  | { type: "plan"; task: string }
  | { type: "init"; content?: string };
```

- Regex 只负责解析 `/plan xxx`、`/init xxx`；**业务控制不写进 Regex**。
- 未来可扩 `/new` `/status` `/memory`，本步不实现。

### A.3 Plan 阶段权限（§16，Runtime Gate）

```text
允许：read_file（第一版仅此）
可选：safe shell inspection
禁止：write_file、dangerous shell
```

- 未 approve 时，Runtime **强制**拦截副作用工具，**不依赖 LLM 自觉**（§17）。

---

## B. 设计（怎么做）

### B.1 CommandRouter（`src/core/command-router.ts`）

```text
CLI ──┐
      ├── CommandRouter → Runtime
Web ──┘
```

- 输入原始字符串 → 输出 `UserCommand`。
- 收口 `/init`（Step 2 的拦截正式归位到这里）。

### B.2 Planner（`src/core/planner.ts`）

- 输入：`/plan <task>` 的 task + 仓库只读调查（read_file）。
- 输出 Markdown（§15）：
  ```md
  ## Goal
  ## Acceptance Criteria
  ## Plan
  1. 2. 3.
  ## Risks
  ```
- 解析为：
  ```ts
  interface AgentGoal { description: string; acceptanceCriteria: string[]; }
  interface AgentPlan { steps: string[]; risks?: string[]; }
  ```

### B.3 Approval Gate（§17）

```text
Plan 生成 → 展示 → 用户 approve / reject / revise
```

- approve → `session.goal = goal; session.plan = plan;` 进入正常 Agent Loop（§18）。
- reject → 丢弃，不执行。
- revise → 带用户反馈重新 Planner。
- 审批是 **Runtime Gate**，复用 Web/CLI 已有的暂停-恢复交互（与 permission 同机制），
  **不是**让 LLM 自行决定何时 ask_user。

### B.4 Plan 权限的实现落点

- 在 Plan 模式下，给 Registry/执行链一个"只读模式"开关：dangerous 工具与 write_file 直接拒绝并回灌，
  与既有 Permission fail-closed 一致。批准后解除只读模式。
- 落点集中在执行入口，**不改 Agent Loop 控制分支**。

### B.5 Goal 稳定 / Plan 可变（§13、§18、§39）

- Goal：相对稳定，默认执行期不改。
- Plan：允许因执行实际情况更新（如测试命令与预想不同）。
- 二者经 Step 2 的 `buildSystemPrompt` 注入 `# Current Goal` / `# Current Plan`。

---

## C. 验收条件（DoD）

### C.1 Acceptance Case 4 — Plan Approval（§38）

```text
输入：/plan add a calculator CLI
应：inspect → 输出 Goal → 输出 Plan → 请求批准
批准前：不得 write_file、不得 destructive shell
批准后：方可执行
```

### C.2 Acceptance Case 5 — Goal/Plan（§39）

```text
计划：1 inspect files → 2 implement → 3 run tests
若实际测试命令不同：Plan 可修改；但 Goal 不变。
```

### C.3 功能

- [ ] CLI 与 Web 都经 CommandRouter；`/plan` `/init` 在两端行为一致。
- [ ] Planner 能只读调查仓库并产出结构化 Goal/Plan/Criteria/Risks。
- [ ] approve/reject/revise 三态均可用。
- [ ] 未批准状态下副作用工具被 Runtime 拦截（非 LLM 自觉）。

### C.4 隔离与不回归

- [ ] Agent Loop 控制分支未因 Plan 模式改变。
- [ ] 原有能力（含 Step 1/2）不回归。

### C.5 Trace（§33）

- [ ] 新增 `plan_start` `plan_generated` `plan_approved` `plan_rejected`。

---

## D. 测试（§43）

- `tests/command-router.test.ts`：`/plan xxx`、`/init xxx`、普通 task 解析；仅解析不含业务。
- `tests/planner.test.ts`：Mock LLM 产出 → 解析为 Goal/Plan/Criteria/Risks。
- Approval Gate：未批准时副作用工具被拒（可用 Mock 交互 + AllowAll 对照）。
- 全量 `npm run build` + `npm test` 绿；原有测试不破坏。
