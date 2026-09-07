# Phase 4 前端 · Step 4/5/6 — 运行时状态（完成校验 / 停滞早停 / 记忆沉淀）

对应后端：`12`（Completion Gate）、`13`（Progress/Early Stop）、`14`（Memory Consolidation 的轻提示）。
契约来源：`web/transport.js`。定位：前端可**并行**，Mock 先行。本文集中处理"运行时控制信号"的可视化。

---

## A. SPEC（做什么）

### A.1 契约扩展

`AgentEvent` 新增：

```ts
// 完成校验（Step 4）
| { type: "completion_check"; complete: boolean; reason?: string; remaining?: string[]; attempt: number }
// 停滞与早停（Step 5）
| { type: "stall_warning"; round: number }
| { type: "early_stop"; stopReason: "stalled" | "completion_check_limit" | "max_steps"; detail?: string }
// 记忆沉淀（Step 6，轻提示）
| { type: "soul"; action: "consolidated"; summary: string }   // 复用 17 定义的 soul 事件
```

### A.2 交付清单

- [ ] **Completion 校验卡**：complete=false 时展示 reason + remaining 列表（"待办"样式），并提示"Agent 将继续执行"；complete=true 时一句"Verified"绿标。
- [ ] **多次校验可视**：用 `attempt` 展示第几次校验（如 "Completion check #2"），逼近上限时给出提示。
- [ ] **Stall 警告**：`stall_warning` 渲染成琥珀色提示条（"检测到重复动作，正在尝试重新评估"）。
- [ ] **Early Stop**：`early_stop` 渲染成显著的终止卡，标明 stopReason（stalled / completion_check_limit / max_steps），并结束本轮、恢复输入。
- [ ] **记忆沉淀提示**：`soul(consolidated)` 在事件流插一条轻提示 + 刷新 Soul 面板（面板见 `17`）。
- [ ] Mock 剧本覆盖：完成驳回→补做→通过；连续重复→警告→早停；满 N 轮→记忆沉淀提示。

### A.3 非目标

- 前端不做校验/停滞判定逻辑（都是 Runtime 的事）；前端只呈现信号。
- 不做 token/cost 面板（后端 §29 明确非 P0）。

---

## B. 设计（怎么做）

### B.1 渲染映射（`app.js` 新增分支）

| 事件 | UI 表现 |
| --- | --- |
| `completion_check(false)` | 校验卡：reason + remaining 勾选列表 + "continuing…"；页面状态置 `running` |
| `completion_check(true)` | 一条绿色 "Completion verified"（可并入随后的 done） |
| `stall_warning` | 琥珀提示条，显示 round；不结束流程 |
| `early_stop` | 显著终止卡（红/琥珀），显示 stopReason + detail；`setRunningState(false)` |
| `soul(consolidated)` | 事件流轻提示 "Memory consolidated" + Soul 面板刷新高亮 |

- `done` 与 `early_stop` 都要走结束收尾（恢复输入、状态徽章更新）；区别在于 `done`=success、`early_stop`=warn/danger。

### B.2 与既有状态机的衔接

- 复用 `setStatus()` / `setRunningState()`：completion pending 时保持 running；early_stop / done 时置终态并解锁输入。
- `stopReason` 与后端 RPD §23/§27/§47 对齐（`completion_check_limit`、`stalled`、`max_steps`）。

### B.3 Mock 侧（`mock.js`）

- `completion_gate`（对应 RPD Acceptance Case 6）：
  ```text
  message(user:create hello.py and verify it runs)
  → tool_call(write_file hello.py) → tool_result
  → completion_check(complete:false, remaining:["run hello.py"], attempt:1)
  → tool_call(shell python hello.py) → tool_result(Hello...)
  → completion_check(complete:true, attempt:2) → done
  ```
- `early_stop_stall`（对应 RPD Acceptance Case 7）：
  ```text
  连续 3 次 tool_call(read_file same) → same tool_result
  → stall_warning(round:3)
  → 再次重复 → early_stop(stopReason:"stalled")
  ```
- `memory_consolidate`（对应 RPD Acceptance Case 8，轻提示）：
  ```text
  ...（若干 turn 后）→ soul(consolidated, summary:"Added preference: concise answers")
  ```
- `MockEventSource` 顺序回放即可，无需额外挂起。

---

## C. 验收条件（Mock 优先）

- [ ] `completion_gate`：出现 complete:false + remaining，Agent 继续并最终 complete:true → done（对应 Case 6）。
- [ ] `early_stop_stall`：先 stall_warning，再 early_stop(stalled)，**不**跑到 maxSteps（对应 Case 7）。
- [ ] `early_stop` 卡明确显示 stopReason；结束后输入恢复可用。
- [ ] `soul(consolidated)` 出现轻提示且 Soul 面板刷新（对应 Case 8），临时信息不出现在长期 Soul 摘要里。
- [ ] 多次 completion_check 的 `attempt` 正确显示；逼近上限有提示。
- [ ] 不破坏既有 case1/2/3 与六类事件渲染；未知事件不崩。

## D. 与后端接线

- `completion_check`/`stall_warning`/`early_stop`/`soul(consolidated)` 分别由后端 Step 4/5/6 发出。
- 切源仅改注入一行；`web/` 不 import `src/` 内部实现。
