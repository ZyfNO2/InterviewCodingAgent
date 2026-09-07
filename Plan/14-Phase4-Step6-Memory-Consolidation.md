# 阶段四 · Step 6 — Memory Consolidation（周期性 Soul 沉淀）

对应 RPDV2：§9、§34 Step 6、验收 Case 8（§42）。
Commit（§45）：`feat: add periodic soul consolidation`
优先级：**P2**（可放入 README Future Work，不阻塞前五步验收）。
前置：Step 1–5 已验收（尤其 Step 2 的 MemoryService）。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] 每 **10 user turns** 触发一次长期记忆沉淀（`MemoryService.consolidate`）
- [ ] 从最近 Session 抽取 stable facts / preferences / conventions
- [ ] 结构化结果 merge 进 `SOUL.md`，并去重
- [ ] 临时信息不得写入长期 Soul

### A.2 触发口径（§9，关键）

```text
10 user turns ≠ 10 agent steps
User→LLM→read→LLM→shell→LLM 仍只算 1 user turn。
```

- 计数用 `session.userTurns`（Step 1 已维护）。

---

## B. 设计（怎么做）

### B.1 Consolidation 输入（§9.1）

```text
Recent User Messages / Recent Assistant Finals / Relevant Goal / Plan
```
- **不要**把整个 Trace 全量发给模型。

### B.2 Consolidation 输出（§9.2）

```json
{ "facts": [], "preferences": [], "conventions": [] }
```
- 只抽取稳定内容，随后 merge 到 `SOUL.md` 对应小节。

### B.3 去重（§9.3）

```text
normalize line → Set 去重
```
- 避免每十轮重复写入 "Prefer TypeScript"。
- 第一版简单行归一化 + Set；**不做 Vector Memory**（§44）。

### B.4 边界

- 复用 Step 2 的 `MarkdownMemoryService`，写入 `<workspace>/.agent/SOUL.md`。
- 临时事实（"刚跑了 npm test"、本轮 shell 输出）严禁进入 Soul（§6）。

---

## C. 验收条件（DoD）

### C.1 Acceptance Case 8 — Memory Consolidation（§42）

```text
连续 10 user turns，其中稳定表达 "Prefer concise answers."
Consolidation 后 SOUL.md 应存在对应 Preference。
临时信息 "刚刚执行了 npm test" 不得写入长期 Soul。
```

### C.2 功能

- [ ] 满 10 user turns 触发一次（按 userTurns 而非 steps）。
- [ ] 抽取输出符合 `{facts, preferences, conventions}` Schema。
- [ ] merge 去重生效，重复偏好不重复写入。
- [ ] 临时信息被正确排除。

### C.3 隔离与不回归

- [ ] 不阻塞、不改变前五步已验收行为。
- [ ] 原有能力（含 Step 1–5）不回归。

### C.4 Trace（§33）

- [ ] 新增 `memory_consolidated`（已有 `memory_loaded` 见 Step 2）。

---

## D. 测试（§43）

- `tests/memory.test.ts` 扩展：
  - 满 10 turns 触发 consolidate（Mock LLM 返回结构化抽取）；
  - merge 去重；
  - 临时信息不入 Soul。
- 全量 `npm run build` + `npm test` 绿；原有测试不破坏。

---

## E. 时间不足决策（§46）

```text
若笔试时间已明显超出：做到 P1（Step 5）即停止。
Step 6 自动沉淀可作为 README 的 Extension / Future Work。
```
