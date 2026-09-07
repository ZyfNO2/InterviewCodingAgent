# Phase 4 · 前后端同步 & 真人调试检查点（Step 2 / 4 / 6）

配套：后端 `08~14`、前端 `15~19`、接线机制 `06-Integration-WebUI-Backend.md`。
定位：后端**每完成 2 步**做一次"接线 + 真人手动调试"同步。三个检查点分别在
**Step 2、Step 4、Step 6 结束时**触发，把这两步新增能力从前端 **Mock 切到真后端 SSE**，由真人按脚本走查一遍再进入下一批。

目的：避免"后端全做完再一次性接线"的大爆炸联调；每两步一验，问题定位范围小、可回退。

---

## 0. 为什么切在 2 / 4 / 6

后端 6 步天然两两成组，每组恰好对应一块可独立演示的前端能力：

| 检查点 | 后端已完成 | 对应前端 | 真人验什么 |
| --- | --- | --- | --- |
| **Sync A**（Step 2 末） | Step 1 Session + Step 2 Soul/`/init` | FE-1 `16` + FE-2 `17` | 连续会话 / 会话隔离 / Soul 载入影响 / `/init` |
| **Sync B**（Step 4 末） | Step 3 Plan-Goal + Step 4 Completion | FE-3 `18` + FE-4 完成校验部分 `19` | `/plan` 审批门 / 批准前无副作用 / Completion 驳回 |
| **Sync C**（Step 6 末） | Step 5 Progress + Step 6 Memory | FE-4 停滞/早停 + 记忆提示 `19` | Stall 警告 / Early Stop / 记忆沉淀提示 |

每个检查点结束、真人验收通过后，才继续下一批后端开发。

---

## 1. 通用同步流程（每个检查点都照此走）

### 1.1 接线动作（沿用 `06-Integration` 的机制，不新造）

1. **后端事件翻译补齐**：确认后端 `src/web` 服务已把本批新增的运行时事件翻译成前端契约事件
   （契约见 `15-Phase4-Frontend-Overview.md` §3；如 `session/soul/command/goal/plan/completion_check/stall_warning/early_stop`）。
   翻译层只搬运，不改 Agent Loop 控制流（红线）。
2. **前端切源**：`web/app.js` 把 `activeSource` 从 `MockEventSource` 切到 `SseEventSource`
   （或用页面顶部"模式"下拉切到 "Live API"），后端地址指向本地服务。
3. **启动后端**：用受管后台任务启动本地 Web 服务，仅监听 `127.0.0.1`，记录确切 URL。
4. **冒烟**：先跑一条最简单任务确认 SSE 通、事件能渲染，再进入真人脚本。

### 1.2 真人调试记录

每个检查点在 `docs/` 下留一份手动验收记录（如 `docs/sync-A-debug.md`），至少含：
- 走查日期、后端 commit、前端 commit；
- 每条脚本步骤的实际现象与截图/终端片段；
- PASS / FAIL 结论与发现的问题清单。

### 1.3 回退原则

- 若接线不稳定：**前端切回 Mock 即可继续演示**，不阻塞后端后续步骤（红线：核心不动、可回退）。
- 真人调试发现的问题按"后端翻译层 / 前端渲染 / 契约不一致"三类归因，不改 Agent Loop 控制流。

---

## 2. Sync A — Step 2 末（Session + Soul）

### 2.1 前置

- [ ] 后端 Step 1、Step 2 已各自单元验收通过（`09`、`10` 的 DoD）。
- [ ] 前端 `16`、`17` 的 Mock 验收已通过。

### 2.2 接线补齐

- [ ] 后端在 `session_start` / 每个 user turn / `loadSoul` / `/init` 处，向 SSE 发出
      `session`、`soul(loaded|updated)`、`command(init)` 事件（契约见总览 §3）。
- [ ] `/init` 由后端 CommandRouter（或其雏形）解析，前端只发原文。

### 2.3 真人调试脚本

1. 新建会话，输入 `Create hello.ts`；观察 write_file 卡与 done。
2. **同一会话**再输入 `Now run the file you created`；
   PASS：Agent 无需追问文件名即知道是 `hello.ts`（对应 RPD Acceptance Case 1）。
3. 点「新建会话」，输入 `What file did I just create?`；
   PASS：新会话看不到上一会话的 `hello.ts` 上下文（Acceptance Case 2）。
4. 输入 `/init Prefer TypeScript over Python`；
   PASS：出现 `command` 反馈 + Soul 面板刷新；`<workspace>/.agent/SOUL.md` 被创建/更新。
5. 新会话输入 `Create a small script`；
   PASS：无其他约束时 Agent 倾向 TypeScript（Acceptance Case 3）。

### 2.4 通过标准

- [ ] 上述 1–5 全 PASS；会话条 turn 计数正确；Soul 面板内容与磁盘 `SOUL.md` 一致。
- [ ] 现有六类事件与 case1/2/3 不回归；未知事件不致崩。
- [ ] 记录写入 `docs/sync-A-debug.md`。

---

## 3. Sync B — Step 4 末（Plan 审批 + Completion）

### 3.1 前置

- [ ] 后端 Step 3、Step 4 已各自单元验收通过（`11`、`12`）。
- [ ] 前端 `18` 与 `19` 的完成校验部分 Mock 验收已通过。

### 3.2 接线补齐

- [ ] 后端在 Planner 产出、审批、执行处发 `goal`、`plan(proposed|approved|rejected|revised)`、
      `ask(kind:"plan_approval")`；前端经 `reply` 回传 `plan_decision`。
- [ ] 后端在 Completion Gate 处发 `completion_check(complete,reason,remaining,attempt)`。

### 3.3 真人调试脚本

1. 输入 `/plan add a calculator CLI`；
   PASS：先出 Goal 卡 + Plan 卡（proposed），再出审批卡；**此时无任何 write/shell 调用**（Acceptance Case 4）。
2. 点 **Reject**；PASS：无副作用工具执行，流程明确结束。
3. 再次 `/plan ...` → 点 **Revise** 填一句意见；PASS：Plan 以 `revised` 重生成，Goal 文案不变（Acceptance Case 5）。
4. 再点 **Approve**；PASS：批准后才出现 write_file/shell 调用并推进。
5. 输入 `Create hello.py and verify that it runs`（触发 plan-only 完成校验）；
   若 Agent 只写不跑：PASS：出现 `completion_check(complete:false, remaining:["run hello.py"])`，Agent 继续执行后再 `complete:true`（Acceptance Case 6）。

### 3.4 通过标准

- [ ] 审批门在**批准前确无副作用工具**（真人确认，非 Mock）。
- [ ] Reject/Revise/Approve 三态真实驱动后端行为。
- [ ] Completion 驳回能真实回灌并让 Agent 续跑到通过；`attempt` 显示正确。
- [ ] 不回归；记录写入 `docs/sync-B-debug.md`。

---

## 4. Sync C — Step 6 末（Progress/早停 + Memory）

### 4.1 前置

- [ ] 后端 Step 5、Step 6 已各自单元验收通过（`13`、`14`）。
- [ ] 前端 `19` 的停滞/早停/记忆提示 Mock 验收已通过。
- [ ] 注：Step 6 为 P2；若按 RPD §46 决定停在 P1，则 Sync C 只验早停部分，记忆沉淀转 README Future Work。

### 4.2 接线补齐

- [ ] 后端在停滞检测处发 `stall_warning(round)`、`early_stop(stopReason)`。
- [ ] 后端在满 10 user turns 沉淀处发 `soul(consolidated,summary)`。

### 4.3 真人调试脚本

1. 构造一个会让 Agent 反复读同一文件、无新信息的任务（或用受控 Mock 后端剧本）；
   PASS：连续无进展先出 `stall_warning`（琥珀提示），Agent 收到重规划提示尝试自纠。
2. 若仍无进展；PASS：出现 `early_stop(stopReason:"stalled")` 终止卡，**未跑到 maxSteps**（Acceptance Case 7）；输入恢复可用。
3.（若做 Step 6）连续进行约 10 个 user turn，其间稳定表达 `Prefer concise answers`；
   PASS：出现 `soul(consolidated)` 轻提示，Soul 面板/`SOUL.md` 新增该偏好；临时信息（如"刚跑了 npm test"）**不**进入长期 Soul（Acceptance Case 8）。

### 4.4 通过标准

- [ ] 早停在真实运行中触发，且 `stopReason` 正确、maxSteps 仍是最终硬限制。
- [ ] （若做）记忆沉淀按 user turn 触发、去重、排除临时信息。
- [ ] 不回归；记录写入 `docs/sync-C-debug.md`。

---

## 5. 三检查点的总门禁

- [ ] Sync A / B / C 各自的通过标准全部满足。
- [ ] 每次同步后：`npm run build` + `npm test` 仍全绿（接线不引入回归）。
- [ ] Agent Loop 控制流在三次接线中**始终未因 Web 而分叉**（`06` 的"核心不动"验证）。
- [ ] 任一检查点接线失败时，前端可切回 Mock 演示，后端主线继续推进。
- [ ] 三份 `docs/sync-*-debug.md` 记录齐全，可作为演示与 Review 依据。

---

## 6. 给执行者的最小操作清单（每次同步复用）

```text
1) 确认本批后端 DoD + 对应前端 Mock DoD 均通过
2) 后端补齐本批事件翻译（不改 Agent Loop）
3) 启动本地 Web 服务（受管后台任务，仅 127.0.0.1，记录 URL）
4) 前端切 SseEventSource → 冒烟一条任务
5) 按本文对应检查点脚本逐条真人走查，记录现象
6) 全 PASS → 提交 docs/sync-*-debug.md → 进入下一批
   有 FAIL → 归因(翻译/渲染/契约) → 修复 → 复验；实在不稳则切回 Mock 不阻塞
```
