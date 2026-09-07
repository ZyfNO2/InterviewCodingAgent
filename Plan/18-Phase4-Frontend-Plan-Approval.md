# Phase 4 前端 · Step 3 — Plan / Goal 展示 + 审批 Gate

对应后端：`11-Phase4-Step3-Plan-Goal.md`（Planner / Goal / Approval Gate）。
契约来源：`web/transport.js`。定位：前端可**并行**，Mock 先行。核心是"批准前不执行副作用"的可视化。

---

## A. SPEC（做什么）

### A.1 契约扩展

`AgentEvent` 新增：

```ts
| { type: "goal"; description: string; acceptanceCriteria: string[] }
| { type: "plan"; steps: string[]; risks?: string[];
    status: "proposed" | "approved" | "rejected" | "revised" }
```

计划审批复用既有 `ask` 通道（kind 扩展）：

```ts
| { type: "ask"; id: string; kind: "plan_approval"; question: string }
```

`AgentReply` 新增：

```ts
| { type: "plan_decision"; id: string; decision: "approve" | "reject" | "revise"; note?: string }
```

### A.2 交付清单

- [ ] **Goal 卡片**：展示 description + acceptanceCriteria（勾选列表样式）。
- [ ] **Plan 卡片**：有序步骤列表 + 可选 Risks；顶部显示 `status` 徽章。
- [ ] **审批 Gate**：`ask(kind:"plan_approval")` 渲染成三选一操作：Approve / Reject / Revise；Revise 弹出文本框收集意见。
- [ ] 审批前的可视约束：在未批准状态，UI 明确标注"Plan pending approval — 副作用工具已冻结"；若此时出现任何 write/shell 的 tool_call（不应发生），以红色异常提示。
- [ ] Plan 更新可视化：执行中收到 `plan(status:"revised"/"approved")` 时刷新卡片并高亮变更（Goal 不变）。
- [ ] Mock 剧本覆盖：approve 流程、reject 流程、revise→重生成流程。

### A.3 非目标

- 前端不判断计划内容是否合理（Runtime/LLM 的职责）。
- 前端不强制权限（真正的 Gate 在 Runtime）；前端只做"决策采集 + 状态呈现"。

---

## B. 设计（怎么做）

### B.1 渲染（`app.js` 新增分支 + `index.html` 样式）

| 事件 | UI 表现 |
| --- | --- |
| `goal` | Goal 卡：description 加粗 + acceptanceCriteria 复选列表 |
| `plan` | Plan 卡：有序步骤；status 徽章（proposed=琥珀 / approved=绿 / rejected=红 / revised=蓝）；risks 折叠 |
| `ask(plan_approval)` | 审批卡：Approve(绿) / Reject(红) / Revise(次要) 三按钮；点击后禁用并显示结果 tag |

- 审批卡沿用现有 `ask-card` 结构与暂停-恢复机制（`MockEventSource` 已支持 `ask`→等 `reply`）。
- Revise：点击后就地展开输入框，提交 `plan_decision{decision:"revise", note}`。

### B.2 "批准前冻结"可视化

- 收到 `plan(status:"proposed")` 后，在 Plan 卡上打 "Awaiting approval" 状态，并在页面状态徽章置 `warn`。
- 约定：Mock 的计划剧本在 approve 之前**不产出** write_file/shell 的 tool_call；用于演示"批准前无副作用"（对应 RPD Acceptance Case 4）。
- 防御性提示：若在 pending 状态收到 write/shell 的 `tool_call`，渲染成红色异常卡（正常后端不会发，用于回归保护）。

### B.3 Mock 侧（`mock.js`）

- `plan_approve`：
  ```text
  command(plan) → plan_start? → goal(...) → plan(status:"proposed")
  → ask(plan_approval) → [approve] → plan(status:"approved")
  → tool_call(write_file) → tool_result → tool_call(shell) → tool_result → done
  ```
- `plan_reject`：approve 处改为 reject → plan(status:"rejected") → done("Plan rejected, no changes made.")，其间**无**副作用工具。
- `plan_revise`：ask → [revise + note] → 重新 goal/plan（status:"revised"）→ 再次 ask → approve → 执行。
- `MockEventSource.reply` 已能 resolve `ask`；对 `plan_decision` 做同样的挂起-恢复处理（approve/reject/revise 走不同后续分支）。

---

## C. 验收条件（Mock 优先）

- [ ] `/plan add a calculator CLI` 演示：先出 Goal + Plan，再出审批卡，**批准前无 write/shell**。
- [ ] Approve 后才出现副作用工具调用并跑到 done（对应 Acceptance Case 4）。
- [ ] Reject 后不产生任何副作用工具，流程明确结束。
- [ ] Revise 后带 note 重新生成 Plan（status:"revised"），Goal 文案不变（对应 Acceptance Case 5）。
- [ ] pending 状态若异常出现副作用 tool_call，UI 以红色异常提示（回归保护）。
- [ ] 不破坏既有 case1/2/3 与六类事件渲染。

## D. 与后端接线

- `goal`/`plan`/`ask(plan_approval)` 由后端 Step 3 的 Planner + Approval Gate 发出；`plan_decision` 经 `reply` 回传。
- 真正的"批准前冻结"由 Runtime 强制（前端只呈现）；前端约定用于 Mock 演示与回归保护。
