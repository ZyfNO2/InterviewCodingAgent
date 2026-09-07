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

## 工具

| 工具 | 入参 | 行为 |
| --- | --- | --- |
| `read_file` | `{ path }` | 读取 workspace 内文件，返回文本内容 |
| `write_file` | `{ path, content }` | 写入/覆盖 workspace 内文件，自动建父目录 |
| `shell` | `{ command }` | 在 workspace 下执行命令，返回 `exit` + `stdout` + `stderr`（60s 超时） |

错误一律以结构化文本回灌模型（`ToolResult{ ok:false }`）而非中断，让 Loop 有自我纠正机会。

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
