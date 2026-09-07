# 阶段二 — 能力扩展

目标：在不改动 Agent Loop 核心的前提下，通过 Context / Registry 挂载新能力，验证运行时的可扩展性。
前置条件：阶段一已完成并提交 `feat: implement minimal coding agent runtime`。

优先级：

```text
P0  Permission Control
P0  ask_user
P1  Parallel Tool Calling
P2  WebUI（默认不做）
```

---

## Feature A — Tool Permission Control (P0)

### A.1 SPEC

- `Tool` 接口新增风险等级：
  ```ts
  risk: "safe" | "dangerous";
  ```
- 默认风险分级：

  | 工具 | risk |
  | --- | --- |
  | `read_file` | safe |
  | `write_file` | dangerous |
  | `shell` | dangerous |

- 危险工具执行前必须获得人类批准，否则跳过执行并把"被拒绝"作为 ToolResult 回灌模型。

### A.2 设计

- 新增 `core/permission.ts` — `PermissionService`：
  ```ts
  interface PermissionService {
    check(tool: Tool, args: unknown, ctx: Context): Promise<boolean>;
  }
  ```
- CLI 实现走 readline：`Approve <tool> [y/N]:`，并展示参数摘要（如 shell 的完整命令）。
- 注入方式：`ctx.provide("permission", permissionService)`。
- 调用链（Registry 内串接，Agent Loop 不变）：
  ```text
  Agent → Registry.execute → PermissionService.check → Tool.execute
  ```
- 被拒绝时返回：`{ ok:false, output:"denied by user" }`。
- 设计要点：Permission 逻辑集中在 Registry.execute 一处，Agent Loop 零改动。

### A.3 验收条件

- [ ] 执行 `shell`（如 `rm` 类命令）前出现 `Approve? [y/N]` 提示。
- [ ] 输入 `N` → 命令不执行，模型收到 denied 结果并合理收尾。
- [ ] 输入 `y` → 正常执行。
- [ ] `read_file`（safe）不触发批准提示。
- [ ] Agent Loop 源码相较阶段一无结构性改动（能力挂在 Registry/Context）。

---

## Feature B — ask_user Tool (P0)

### B.1 SPEC

- 注册特殊工具 `ask_user`：
  ```json
  { "question": "文件应该保存在哪里？" }
  ```
- 执行时暂停 Agent，向人类提问，收到输入后作为 ToolResult 回灌，Agent 恢复。

### B.2 设计

- `tools/ask-user.ts`：`execute` 内通过 CLI 交互层读一行输入。
  ```text
  LLM → ask_user → Agent Pause → CLI Input → Tool Result → Agent Resume
  ```
- 交互层与 Permission 复用同一个 readline 封装（`cli` 层导出一个 `prompt(question)`）。
- 证明 Agent Loop 支持 `LLM → Environment → Human → Agent`，而非仅 `LLM → Tool`。
- `risk: "safe"`（问问题不危险），`parallelSafe: false`。

### B.3 验收条件

- [ ] 给一个信息不足的任务，模型会调用 `ask_user` 提问。
- [ ] 终端展示问题并等待输入；输入后 Agent 用该答案继续。
- [ ] 最终答复体现采纳了人类输入。

---

## Feature C — Parallel Tool Calling (P1，时间够再做)

### C.1 SPEC

- `Tool` 新增：
  ```ts
  parallelSafe: boolean;
  ```

  | 工具 | parallelSafe |
  | --- | --- |
  | `read_file` | true |
  | `write_file` | false |
  | `shell` | false |
  | `ask_user` | false |

- 当模型一次返回多个 tool_calls 时，连续的 `parallelSafe` 工具可并行执行；其余顺序执行。

### C.2 设计

- 在 Registry 或 Agent Loop 的"执行一批 calls"处理内：
  ```ts
  // 简单策略：把连续 parallelSafe 的分组 Promise.all，其余逐个 await
  ```
- 不做复杂 Scheduler；保持顺序语义正确（结果按 call 顺序回灌）。
- Permission 检查仍逐个进行（危险工具本就非 parallelSafe）。

### C.3 验收条件

- [ ] 一次读取多个文件（如 package.json + README + tsconfig）时并行发起。
- [ ] tool 结果按原 call 顺序正确回灌，答复正确。
- [ ] 含 `write_file` / `shell` 的批次不发生错误并行。

---

## Feature D — WebUI (P2，默认不做)

仅在阶段一/二全部完成且时间充裕时考虑；否则明确不做，避免抢占核心时间。

---

## 阶段二整体验收

- [ ] Permission + ask_user 可完整演示。
- [ ] Agent Loop 核心未因扩展而复杂化（扩展点在 Context / Registry）。
- [ ] README 增补 Permission / ask_user / (可选)Parallel 说明与演示。
- [ ] 最终 commit 提交。
