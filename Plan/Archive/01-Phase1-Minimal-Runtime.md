# 阶段一 — 最小可运行 Agent Runtime (P0)

目标：交付一个正确、清晰、易 Review 的最小 Coding Agent，能完成多轮 Tool Calling Loop。
完成标准：本文"验收条件"全部通过，且单独提交 commit `feat: implement minimal coding agent runtime`。

---

## 0. 架构冻结原则（重要）

Phase 1 一旦开始编码即**冻结架构**。后续所有架构优化意见一律推迟到 Phase 2 以"外挂/装饰"的方式处理，Phase 1 期间**不回头重构**。目的：保持开发连续性，让 commit 呈现"小而完整的 Phase 1 → 明确 commit → Phase 2 在其上自然扩展"，而不是"写一半→看到更优架构→重构→再重构"。

| 曾提出的意见 | Phase 1 处理 | 后续处理 |
| --- | --- | --- |
| `Context` 基于 `Map`，偏 Service Locator | **保留不动** | Phase 2 可选加 typed facade，或完全不改 |
| 测试补得太晚 | **不改 Runtime**，commit 前补最小测试即可 | 见验收 C.5 |
| Parallel 层次不清 | **完全不做**，`for...await` 顺序执行 | Phase 2 做并行时再决定是否抽 `ToolExecutor` |
| Permission | Phase 1 不做 | Phase 2 用 Registry 装饰器外挂 |
| WebUI | 不碰 Runtime | 独立目录 + Mock 契约并行开发 |

反面模式警示：不要为"未来可能做的并行/权限"提前抽象（Future-Requirement-Driven Architecture）。笔试规模不值得。

关于 `Context`：面试若问"为什么自己写 Context"，标准答复——Agent Loop 不直接依赖具体 Provider/Tool 实现，用极简 Runtime Context 做依赖注册；它是轻量 Service Container，未实现完整 DI Framework，因为笔试规模不需要。这是"最小实现、避免过度工程"的合理取舍。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] CLI 输入任务
- [ ] LLM Tool Calling
- [ ] Agent Loop（带 maxSteps）
- [ ] Tool：`read_file` / `write_file` / `shell`
- [ ] Tool Registry
- [ ] Context / 简易 DI
- [ ] 基础错误处理
- [ ] README
- [ ] `.env.example`

### A.2 核心类型契约

```ts
// 工具执行结果
interface ToolResult {
  ok: boolean;
  output: string;      // 成功输出或错误说明，都以文本回灌模型
}

// 工具统一接口
interface Tool {
  name: string;
  description: string;
  schema: ZodType;                          // 入参 schema（zod）
  execute(args: unknown, ctx: Context): Promise<ToolResult>;
}

// LLM 响应两态
type LLMResponse =
  | { type: "final"; text: string }
  | { type: "tool_calls"; calls: ToolCall[] };

interface ToolCall {
  id: string;          // tool_call_id，回灌时必须原样带回
  name: string;
  arguments: string;   // 模型给的 JSON 字符串，执行前 parse + zod 校验
}
```

### A.3 三个工具的入参契约

| 工具 | 入参 | 行为 |
| --- | --- | --- |
| `read_file` | `{ path: string }` | 读取 workspace 内文件，返回文本内容 |
| `write_file` | `{ path: string, content: string }` | 写入/覆盖 workspace 内文件，自动建父目录 |
| `shell` | `{ command: string }` | 在 workspace 下执行命令，返回 stdout+stderr+exitCode |

### A.4 CLI 契约

```bash
npm start -- --workspace ./examples/demo --max-steps 20
# 或交互式读入任务；也支持直接把任务作为参数
```

- `--workspace <dir>`：Agent 工作根目录，默认 `process.cwd()`。
- `--max-steps <n>`：循环上限，默认 20。
- 运行时打印：每轮 tool 调用（名称+参数摘要）、tool 结果摘要、最终答案。

### A.5 配置（.env）

```text
OPENAI_API_KEY=     # 必填
OPENAI_BASE_URL=    # OpenAI-compatible 端点，可选
OPENAI_MODEL=       # 模型名，默认给一个占位
```

---

## B. 设计（怎么做）

### B.1 目录结构

```text
src/
├── index.ts              # 入口，解析参数 → 组装 Context → 跑 Agent
├── agent/
│   ├── agent.ts          # Agent Loop
│   └── types.ts          # Tool / ToolResult / Message / LLMResponse
├── core/
│   └── context.ts        # 极简 DI 容器
├── llm/
│   └── provider.ts       # OpenAI-compatible 封装 + schema 转换
├── tools/
│   ├── registry.ts       # 注册 / 查找 / 导出 LLM schema
│   ├── read-file.ts
│   ├── write-file.ts
│   └── shell.ts
└── cli/
    └── cli.ts            # 参数解析 + readline + 输出渲染
```

### B.2 Context（极简 DI）

```ts
class Context {
  private services = new Map<string, unknown>();
  workspace: string;
  config: AgentConfig;

  provide<T>(key: string, value: T): void;
  resolve<T>(key: string): T;   // 缺失时抛明确错误
}
```

- 约定注入键：`"llm"`、`"tools"`、（阶段二）`"permission"`。
- Agent 构造函数只接收 `Context`，其余能力从中 `resolve`。

### B.3 Tool Registry

- `register(tool)`：重名报错。
- `get(name)` / `list()`。
- `toLLMSchema()`：把每个 tool 的 zod schema 转 JSON Schema（用 `zod-to-json-schema` 或手写最小转换），产出 OpenAI `tools` 数组。
- `execute(call, ctx)`：`JSON.parse(arguments)` → `schema.safeParse` → 调 `tool.execute`；任何一步失败都返回 `ToolResult{ ok:false, output }`，不抛出。

### B.4 文件工具的路径约束

```ts
const abs = path.resolve(ctx.workspace, input.path);
if (!abs.startsWith(path.resolve(ctx.workspace) + path.sep) && abs !== path.resolve(ctx.workspace))
  return { ok: false, output: "path escapes workspace" };
```

### B.5 shell 工具

- 用 `child_process.exec`（或 spawn shell），`cwd = ctx.workspace`。
- 捕获 `stdout` / `stderr` / `exitCode`，拼成结构化文本：
  ```text
  exit: <code>
  --- stdout ---
  ...
  --- stderr ---
  ...
  ```
- 设超时（如 60s）防止挂死。

### B.6 LLM Provider

- 封装官方 `openai` SDK（`baseURL` 可指向 compatible 端点）。
- `chat(messages, tools)`：调 `chat.completions.create`，`tool_choice: "auto"`。
- 解析响应：有 `tool_calls` → `{type:"tool_calls"}`；否则 `{type:"final", text}`。

### B.7 Agent Loop（核心，保持简单）

```ts
messages = [systemPrompt, userTask];
for (step = 0; step < maxSteps; step++) {
  const res = await llm.chat(messages, tools.toLLMSchema());
  if (res.type === "final") return res.text;

  // 先把 assistant 的 tool_calls 消息入历史
  messages.push(assistantToolCallMsg(res.calls));

  for (const call of res.calls) {
    const result = await tools.execute(call, ctx);
    messages.push(toolResultMsg(call.id, result));  // role:"tool"
  }
}
return "Reached maxSteps without final answer.";
```

- System prompt 说明可用工具、workspace 语境、要求最终给自然语言答复。

### B.8 关键取舍

- 不做插件系统、不做生命周期、不做 Context Policy、不做多 Agent、不做 RAG。
- 错误一律回灌模型而非中断，让 Loop 有自我纠正机会。
- Registry 是能力扩展点：阶段二的 permission、parallel 都挂在此处，不改 Agent Loop。

---

## C. 验收条件（Definition of Done）

### C.1 构建 / 静态

- [ ] `npm install` 成功，`npm run build`（tsc）无类型错误。
- [ ] 项目可用 `npm start -- ...` 启动。

### C.2 功能 Case

**Case 1 — 总结文件**
```text
输入：读取 README.md 并总结这个项目。
预期链路：read_file → LLM → final answer
验收：终端出现 read_file 调用记录，且最终输出是对 README 的自然语言总结。
```

**Case 2 — 创建并运行代码**
```text
输入：创建 hello.py，使它输出 Hello Coding Agent，然后运行它并告诉我结果。
预期链路：write_file → shell(python hello.py) → final answer
验收：
  - workspace 下出现 hello.py；
  - shell 执行输出包含 "Hello Coding Agent"；
  - 最终答复转述运行结果。
```

### C.3 健壮性

- [ ] 工具报错（如读不存在文件、shell 非零退出）不使进程崩溃，错误文本回灌后 Agent 能继续或合理收尾。
- [ ] 越权路径（如 `../../etc/hosts`）被拒绝。
- [ ] 达到 `maxSteps` 时返回明确提示而非死循环。

### C.4 commit 前最小测试（不改 Runtime 架构）

在功能写完、commit 之前补最小测试，仅新增 `tests/`，不回头改 Runtime 源码结构：

```text
tests/
├── registry.test.ts   # register 重名报错 / get / toLLMSchema 结构 / execute 校验失败回灌
├── tools.test.ts      # read/write 往返、路径越权被拒、shell 退出码与 stdout 捕获
└── agent.test.ts      # 用 Mock LLM 驱动多轮：tool_calls → 执行 → 回灌 → final；maxSteps 兜底
```

- [ ] `agent.test.ts` 用可注入的 Mock LLM（通过 Context 注入 `"llm"`），无需真实网络即可验证 Loop 闭环。
- [ ] `npm run build` 与 `npm test` 均通过。

### C.5 交付物

- [ ] `README.md`：安装、配置、运行、两个 Case、技术故事段落。
- [ ] `.env.example`：包含三个配置项。
- [ ] 单独 commit：`feat: implement minimal coding agent runtime`，且该 commit 可独立运行。

### C.6 架构冻结自检（对照 D 节）

- [ ] Context 仍是 Map-based（未中途改 typed `RuntimeContext`）。
- [ ] Agent Loop 内工具执行仍是顺序 `for ... await`（未提前引入 parallel / `ToolExecutor`）。
- [ ] Registry 仍是"裸执行"，未内嵌 permission 逻辑（permission 留给阶段二装饰器外挂）。
- [ ] 未为"未来可能的需求"提前抽象（no Future-Requirement-Driven Architecture）。
