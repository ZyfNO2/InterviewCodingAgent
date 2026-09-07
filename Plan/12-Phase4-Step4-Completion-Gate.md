# 阶段四 · Step 4 — Completion Gate（完成校验）

对应 RPDV2：§19–§23、§34 Step 4、验收 Case 6（§40）。
Commit（§45）：`feat: add completion verification`
优先级：**P1**。
前置：Step 1–3 已验收。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] Completion Verifier：对模型的 final 做一次结构化校验
- [ ] 触发策略 `completionCheck: "off" | "plan-only" | "always"`，默认 `plan-only`
- [ ] Incomplete 时把 remaining 回灌 Session，继续 Agent Loop
- [ ] `maxCompletionChecks = 2` 上限，超限以明确 stopReason 收尾

### A.2 触发规则（§20）

```text
默认 plan-only：
  普通对话       → 模型 final 即返回（不额外 LLM 调用）
  /plan 复杂任务 → final 前执行 Completion Check
```

- 不要给所有普通问题都加第二次 LLM 调用。

### A.3 Verifier I/O（§21、§22）

输入：
```text
Goal / Acceptance Criteria / Plan / Recent Tool Facts / Proposed Final Answer
```

输出固定 Schema：
```json
{ "complete": false, "reason": "...", "remaining": ["...", "..."] }
```

Incomplete 回灌（§22）：
```text
Completion verification failed.
Remaining:
- ...
```
→ 继续 Agent Loop。Verifier **不直接执行 Tool**。

---

## B. 设计（怎么做）

### B.1 落点

- 在 Agent Loop 的 "LLM final → return" 之间插入 Completion Gate（§19）：
  ```text
  LLM final → 需要检查? → Verifier → complete?
                                   ├ Yes → Final
                                   └ No  → Feedback 回灌 → Loop
  ```
- 用配置与计数控制，**不改动 Loop 的工具执行分支**；Gate 是 final 出口处的一道判断。

### B.2 Verifier 实现

- 独立函数/服务：拼 Goal+Criteria+Plan+最近 Tool 事实+候选 final，调用 LLM 要求返回上面 JSON。
- 严格解析 JSON；解析失败按"无法判定"处理（保守：视为 complete 以免死循环，或计入 check 次数——实现时选其一并注释理由）。

### B.3 上限与停止（§23）

```text
maxCompletionChecks = 2
超过 → stopReason = "completion_check_limit" → 返回明确状态
```

- 防止 final→reject→final→reject 无限循环。

---

## C. 验收条件（DoD）

### C.1 Acceptance Case 6 — Completion Gate（§40）

```text
Task：Create hello.py and verify that it runs.
若 Agent 只 write_file → final：
Verifier 应返回 { complete:false, remaining:["run hello.py"] }
Agent 必须继续执行验证。
```

### C.2 功能

- [ ] `completionCheck` 三档可配，默认 `plan-only`。
- [ ] 普通对话不触发第二次 LLM 调用。
- [ ] Incomplete 的 remaining 正确回灌并驱动 Loop 继续。
- [ ] 达到 `maxCompletionChecks` 时以 `completion_check_limit` 收尾，不死循环。

### C.3 隔离与不回归

- [ ] Loop 的工具执行分支未改变（Gate 仅在 final 出口）。
- [ ] 原有能力（含 Step 1–3）不回归。

### C.4 Trace（§33）

- [ ] 新增 `completion_check` `completion_rejected`。

---

## D. 测试（§43）

- `tests/completion.test.ts`：
  - completion accept（直接放行）；
  - completion reject（回灌 remaining，Loop 继续）；
  - completion limit（超过 2 次 → stopReason）。
- 用 Mock LLM 构造"只写不跑"场景断言 reject。
- 全量 `npm run build` + `npm test` 绿；原有测试不破坏。
