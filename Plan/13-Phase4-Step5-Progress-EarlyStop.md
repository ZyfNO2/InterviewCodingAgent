# 阶段四 · Step 5 — Progress Tracker + Stall Detection + Early Stop

对应 RPDV2：§24–§28、§34 Step 5、验收 Case 7（§41）。
Commit（§45）：`feat: add progress tracking and early stop`
优先级：**P1**。
前置：Step 1–4 已验收。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] Progress Tracker：识别"有无新进展"，防止原地重试
- [ ] Tool Fingerprint 去重：相同 tool+args+result 不算 progress
- [ ] Stall Detection：连续无进展达阈值先警告、再早停
- [ ] Runtime Budget 扩展：`AgentBudget { maxSteps, maxCompletionChecks, maxStallRounds }`

### A.2 Progress Signal（§25）

以下任一视为有新进展：
```text
成功读取新文件 / 成功写入新文件 / 新的 shell 输出 / 新的 Tool Result /
Goal remaining 减少 / Completion remaining 减少
```

### A.3 预算默认值（§28）

```text
maxSteps            = 20
maxCompletionChecks = 2
maxStallRounds      = 3
```

Token / Cost Budget 本阶段**非 P0**（§29），不改 Provider API。

---

## B. 设计（怎么做）

### B.1 Progress（`src/core/progress.ts`）

```ts
interface ProgressState {
  seenResults: Set<string>;   // tool fingerprint
  stallRounds: number;
  completionChecks: number;   // 与 Step 4 共享计数
}
```

### B.2 Tool Fingerprint（§26）

```text
hash(toolName + normalizedArgs + normalizedResult)
```

- 维护 `seenToolResults: Set<string>`。
- 相同 tool+args+result 重复出现 → 不算 progress。

### B.3 Stall Detection（§27）

```text
连续无新增 progress 计数 stallRounds：
  第一次达到 maxStallRounds：
    注入提示 "You appear to be repeating actions without new information.
              Re-evaluate the current approach before making another tool call."
    允许自我纠正一次。
  再次持续 Stall：
    stopReason = "stalled" → 停止执行。
```

### B.4 落点

- 在每轮 tool_result 之后更新 progress，在 Loop 推进处判断 stall。
- 与 Completion 计数统一到 `session.progress`（§30）。
- maxSteps 仍是最终硬限制（§47）。

---

## C. 验收条件（DoD）

### C.1 Acceptance Case 7 — Early Stop（§41）

```text
Mock Agent 连续三次 read same file → same result
应触发 stall warning；继续重复 → early_stop（而非跑到 maxSteps）。
```

### C.2 功能

- [ ] 相同 tool+args+result 重复不计 progress。
- [ ] 达到 `maxStallRounds` 先注入重规划提示（一次自纠机会）。
- [ ] 持续 stall → `stopReason = "stalled"` 提前停止。
- [ ] 有真实新进展时 stallRounds 正确清零。

### C.3 隔离与不回归

- [ ] maxSteps 仍作为最终硬限制。
- [ ] 原有能力（含 Step 1–4）不回归。

### C.4 Trace（§33）

- [ ] 新增 `stall_warning` `early_stop`。

---

## D. 测试（§43）

- `tests/progress.test.ts`：
  - fingerprint 去重；
  - 连续重复 → warning → early_stop；
  - 出现新结果 → stallRounds 清零。
- 用 Mock Agent/LLM 制造重复动作序列，断言早停而非耗尽 maxSteps。
- 全量 `npm run build` + `npm test` 绿；原有测试不破坏。
