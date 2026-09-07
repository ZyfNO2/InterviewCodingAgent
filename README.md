# Minimal Coding Agent

DSH-inspired **Minimal Agent Runtime**（不是 Mini DeepSeek Harness）——提取 DSH 的核心工程思想（Context / Registry / Agent Loop），压缩到笔试最小规模的一个多轮 Tool Calling Coding Agent。

```text
DSH / Pi Agent
      ↓  提取核心工程思想
Context / Registry / Agent Loop
      ↓
Minimal Coding Agent
```

## 架构

```text
        ┌──────────────┐
        │     CLI      │  参数解析 / readline / 事件渲染
        └──────┬───────┘
        ┌─────▼─────┐
        │ AgentLoop │  控制策略（模型调用 + 状态推进）
        └─────┬─────┘
           Context / DI
       ┌───────┼─────────┐
       ▼       ▼         ▼
      LLM    Tools    (Permission, 阶段二)
               │
     ┌─────────┼─────────┐
     ▼         ▼         ▼
 read_file  write_file  shell
```

角色划分：

| 组件 | 职责 |
| --- | --- |
| `AgentLoop` | 控制策略（模型调用 + 状态推进），带 `maxSteps` 兜底 |
| `Context` | Runtime 依赖容器（极简 DI，约定注入键 `"llm"` / `"tools"`） |
| `ToolRegistry` | Tool 能力注册、查找、导出 LLM schema、统一执行入口 |
| `Tool` | Agent 与环境之间的 Action（zod 入参 schema + `execute`） |

## 安装与配置

```bash
npm install
cp .env.example .env   # 填入你的 API Key
```

`.env` 配置项：

```dotenv
OPENAI_API_KEY=     # 必填
OPENAI_BASE_URL=    # OpenAI-compatible 端点，可选
OPENAI_MODEL=       # 模型名
```

支持任何 OpenAI-compatible 端点（`/v1/chat/completions` + function calling）。

## 运行

```bash
npm run build
npm start -- --workspace ./examples/demo --max-steps 20 "你的任务"
# 不带任务参数则进入交互模式，逐条输入任务
```

- `--workspace <dir>`：Agent 工作根目录，默认 `process.cwd()`。所有文件工具被约束在该目录内，逃逸路径直接拒绝。
- `--max-steps <n>`：Agent Loop 步数上限，默认 20，达到上限返回明确提示而非死循环。
- 运行时打印每轮 tool 调用（名称 + 参数摘要）、tool 结果摘要、最终答案。
- 每次启动自动在 `traces/run-<时间戳>.jsonl` 记录全量事件 Trace：任务、每步完整 LLM 请求（messages）/响应、每次 tool 调用与结果——可用于运行后审计与回放（`traces/` 已 gitignore）。
- shell 工具输出自适应解码：严格 UTF-8 探测失败时回退 GBK（中文 Windows cmd），避免 `dir` 等命令中文乱码。

## 工具

| 工具 | 入参 | risk | parallelSafe | 行为 |
| --- | --- | --- | --- | --- |
| `read_file` | `{ path }` | safe | true | 读取 workspace 内文件，返回文本内容 |
| `write_file` | `{ path, content }` | dangerous | false | 写入/覆盖 workspace 内文件，自动建父目录 |
| `shell` | `{ command }` | dangerous | false | 在 workspace 下执行命令，返回 `exit` + `stdout` + `stderr`（60s 超时） |
| `ask_user` | `{ question }` | safe | false | 暂停 Agent，向人类提问，答案作为 ToolResult 回灌后恢复 |

错误一律以结构化文本回灌模型（`ToolResult{ ok:false }`）而非中断，让 Loop 有自我纠正机会。

## 阶段二能力扩展

三个能力都挂在 **Context / Registry** 扩展点上，Agent Loop 核心保持简单。

### Permission Control（Feature A）

- `Tool` 新增 `risk: "safe" | "dangerous"`；危险工具执行前必须经 `PermissionService.check()` 批准。
- 调用链：`Agent → Registry.execute → PermissionService.check → Tool.execute`——permission 逻辑集中在 Registry 一处。
- CLI 实现：`Approve <tool> <参数摘要> [y/N]:`（仅 `y`/`yes` 放行）；EOF / 读入失败一律视为拒绝（**fail-closed**）。
- 未注册 permission 服务时，危险工具直接拒绝。
- 拒绝时模型收到 `denied by user`，可合理收尾而不是崩溃重试。
- 已验证：`n` → 命令不执行、模型报告被拒；`y` → 正常执行；`read_file`（safe）不触发提示。

### ask_user（Feature B）

- `LLM → ask_user → Agent 暂停 → CLI 输入 → Tool Result → Agent 恢复`，证明 Loop 支持 `LLM → Environment → Human → Agent` 闭环。
- 与 Permission 复用同一个共享 readline 封装（`src/cli/prompt.ts`，内部带行缓冲队列，管道/交互两种输入模式均不丢行）。
- 已验证：信息不足时模型主动调用 `ask_user`，人类输入的文件名被采纳并实际创建文件。

### Parallel Tool Calling（Feature C）

- `Tool` 新增 `parallelSafe: boolean`；Registry 新增 `executeBatch(calls, ctx)`：
  连续的 parallelSafe 工具分组 `Promise.all` 并行，其余逐个 `await`；结果严格按原 call 顺序回灌。
- 不做复杂 Scheduler；Permission 逐个检查（危险工具本就非 parallelSafe）。
- 运行时日志会打印批次信息，如 `[step 1] batch of 3 (parallel x3)`。
- 单元测试用耗时探针证明并发真实发生（3×120ms 批次耗时 ≪ 360ms 顺序基线）。

## 验证过的功能 Case

### Case 1 — 总结文件

```text
输入：Read README.md and summarize this project.
链路：read_file → LLM → final answer
结果：终端出现 read_file 调用记录，最终输出为 README 的自然语言总结。
```

### Case 2 — 创建并运行代码

```text
输入：Create hello.py that prints Hello Coding Agent, then run it and tell me the result.
链路：write_file → shell(python3 hello.py) → final answer
结果：workspace 下出现 hello.py，shell 输出 "Hello Coding Agent"，最终答复转述运行结果。
```

### 健壮性（`scripts/robustness-check.mjs`，10/10 通过）

- 越权路径（`../../.env`、绝对路径 `C:\...`）→ `path escapes workspace`
- 未知工具 / 非法 JSON 入参 / zod 校验失败 → 结构化错误回灌，不抛出
- 读不存在文件（ENOENT）、shell 非零退出 → 错误文本回灌，Agent 继续或合理收尾
- `--max-steps 1` → 返回 `Reached maxSteps (1) without a final answer.`，无死循环

### 单元测试（`npm test`，23/23 通过）

基于 Node 内置 `node:test`，无额外测试框架依赖：

| 文件 | 覆盖 |
| --- | --- |
| `tests/registry.test.ts` | register 重名报错 / get / list / toLLMSchema 结构 / execute 四类失败回灌不抛出 |
| `tests/tools.test.ts` | read/write 往返、自动建父目录、路径越权（相对/绝对）被拒、shell 退出码与 stdout/stderr 捕获、cwd |
| `tests/agent.test.ts` | Mock LLM（经 Context 注入 `"llm"`）驱动多轮闭环：tool_calls → 执行 → 回灌 → final；maxSteps 兜底；错误回灌不中断 |
| `tests/permission.test.ts` | 无 permission 服务 fail-closed、拒绝时工具未执行、批准执行、safe 工具零检查、CLI y/yes 语义、EOF 视为拒绝 |
| `tests/ask-user.test.ts` | 人类输入回灌、接口形状（safe/非并行）、zod 失败、EOF 不崩溃 |
| `tests/parallel.test.ts` | 并发探针证明真实并行、混合批次顺序语义、真实工具 parallelSafe 标记、批次中失败不阻塞、batchStats 分组 |

## 关键设计取舍

- **不做**插件系统、生命周期、Context Policy、多 Agent、RAG —— 保持最小正确规模。
- **错误回灌而非中断**：工具失败以文本回灌模型，Loop 有自我纠正机会（已验证 ENOENT 场景）。
- **Registry 是能力扩展点**：阶段二的 permission、parallel tool 挂在此处，不改 Agent Loop。
- **消息闭环**：遵循 OpenAI function calling 规范（`assistant.tool_calls` 带 `type:"function"` + `role:"tool"` + `tool_call_id` 原样带回）。

## 目录结构

```text
src/
├── index.ts              # 入口：解析参数 → 组装 Context → 跑 Agent
├── agent/
│   ├── agent.ts          # Agent Loop
│   └── types.ts          # Tool / ToolResult / Message / LLMResponse
├── core/
│   └── context.ts        # 极简 DI 容器
├── llm/
│   └── provider.ts       # OpenAI-compatible 封装 + 响应解析
├── tools/
│   ├── registry.ts       # 注册 / 查找 / 导出 LLM schema / 统一执行
│   ├── read-file.ts
│   ├── write-file.ts
│   └── shell.ts
└── cli/
    └── cli.ts            # 参数解析 + readline + 输出渲染
```
