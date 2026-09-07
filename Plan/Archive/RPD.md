# Minimal Coding Agent — RPD

## 1. 项目目标

实现一个最小可运行的 Coding Agent：

```text
User
 ↓
Agent Loop
 ↓
LLM
 ↓
Tool Call
 ↓
Tool Runtime
 ├── read_file
 ├── write_file
 └── shell
 ↓
Tool Result
 ↓
LLM
 ↓
Final Answer
```

能够完成：

* 总结指定文件；
* 根据需求创建 / 修改代码文件；
* 执行 Shell 命令；
* 根据命令执行结果继续推理；
* 完成最基本的多轮 Tool Calling Loop。

一期优先完成 **正确、清晰、容易 Review 的 Agent Runtime**，不追求 UI。

---

# 2. 设计原则

核心原则：

> 借鉴 DeepSeek Harness 的 Dependency Injection / Context / Tool Registry 思想，但压缩到笔试需要的最小规模。

不直接：

* Fork DSH；
* 引入复杂插件系统；
* 实现完整生命周期系统；
* 实现复杂 Context Policy；
* 实现 Multi-Agent；
* 实现 RAG / Memory。

目标是让 Reviewer 可以在几分钟内看懂整个 Agent。

---

# 3. 技术选型

推荐：

```text
TypeScript
Node.js
OpenAI-compatible SDK / 公司提供 API
Zod
Commander / readline
```

第一阶段：

```text
CLI
```

即可。

原因：

* 开发时间短；
* Coding Agent 本身就是核心；
* 避免 WebUI 抢时间；
* TypeScript 很适合 Tool Schema / DI / Registry；
* 与 DSH 的工程思想比较接近。

---

# 4. 核心架构

目录初步设计：

```text
src/
├── index.ts
│
├── agent/
│   ├── agent.ts
│   └── types.ts
│
├── core/
│   ├── context.ts
│   └── service.ts
│
├── llm/
│   └── provider.ts
│
├── tools/
│   ├── registry.ts
│   ├── read-file.ts
│   ├── write-file.ts
│   └── shell.ts
│
└── cli/
    └── cli.ts
```

核心依赖关系：

```text
Context
 ├── llm
 ├── tools
 └── config

Agent
 ↓
Context
 ↓
LLM + ToolRegistry
```

---

# 5. 极简 Dependency Injection

参考 DSH 的：

```text
Context
Service
Registry
```

思想。

但只实现极简版本：

```ts
const ctx = new Context()

ctx.provide("llm", llmProvider)
ctx.provide("tools", toolRegistry)

const agent = new Agent(ctx)
```

Context 本质是：

```text
Runtime Dependency Container
```

负责把：

* LLM Provider
* Tool Registry
* Configuration

注入 Agent。

Agent 不直接：

```ts
new OpenAI()
new ShellTool()
```

而只依赖 Context。

这样后续可以很自然替换：

```text
LLM
Tool
Permission Policy
UI
```

而不用修改 Agent Loop。

---

# 6. Tool 抽象

统一接口：

```ts
interface Tool {
  name: string
  description: string
  schema: ZodSchema

  execute(args: unknown, ctx: Context): Promise<ToolResult>
}
```

一期三个 Tool：

```text
read_file
write_file
shell
```

例如：

```text
read_file
{
  path: string
}
```

```text
write_file
{
  path: string
  content: string
}
```

```text
shell
{
  command: string
}
```

注册：

```ts
toolRegistry.register(readFileTool)
toolRegistry.register(writeFileTool)
toolRegistry.register(shellTool)
```

LLM Tool Schema 由 Registry 自动导出。

---

# 7. Agent Loop

整个项目最核心代码应该保持非常简单：

```text
while step < maxSteps:

    response = llm.chat(messages, tools)

    if response.final:
        return response.text

    for toolCall in response.toolCalls:
        result = tools.execute(toolCall)

        messages.push(toolCall)
        messages.push(toolResult)
```

即：

```text
User Prompt
     ↓
LLM
     ↓
Tool Call?
 ┌───┴─────┐
No        Yes
↓           ↓
Answer    Execute Tool
            ↓
        Tool Result
            ↓
          LLM
            ↑
            └──── Loop
```

必须加入：

```text
maxSteps
```

例如：

```text
20 steps
```

避免 Agent 无限运行。

---

# 8. Workspace

Agent 默认只围绕：

```text
process.cwd()
```

工作。

例如：

```bash
npm start -- --workspace ./examples/demo
```

内部 Context：

```ts
ctx.workspace
```

所有文件工具都基于 Workspace 解析路径。

一期可以先做基本路径约束。

---

# 9. 第一阶段交付范围

## P0

必须完成：

* [ ] CLI 输入任务
* [ ] LLM Tool Calling
* [ ] Agent Loop
* [ ] read_file
* [ ] write_file
* [ ] shell
* [ ] Tool Registry
* [ ] Context / 简易 DI
* [ ] maxSteps
* [ ] 基础错误处理
* [ ] README
* [ ] `.env.example`

验证任务：

### Case 1

```text
读取 README.md 并总结这个项目。
```

预期：

```text
read_file
→ LLM
→ answer
```

### Case 2

```text
创建 hello.py，使它输出 Hello Coding Agent，
然后运行它并告诉我结果。
```

预期：

```text
write_file
→ shell python hello.py
→ answer
```

---

# 10. 第一阶段 Git Commit

第一阶段完成后必须单独提交：

```text
feat: implement minimal coding agent runtime
```

保证满足笔试要求：

> 阶段一完成后须提交 commit 后再开始阶段二开发。

此 Commit 必须已经可以独立运行。

---

# 11. 第二阶段方向

建议不要做纯前端 hiring-demo。

直接扩展自己的 Coding Agent，更能和你的简历以及 Agent Runtime 方向形成一致的技术故事。

优先级：

```text
P0  Permission Control
P0  ask_user
P1  Parallel Tool Calling
P2  WebUI
```

最推荐：

## Feature A — Tool Permission

Tool 增加：

```ts
risk: "safe" | "dangerous"
```

例如：

```text
read_file     safe
write_file    dangerous
shell         dangerous
```

增加：

```text
PermissionService
```

调用链：

```text
Agent
 ↓
ToolRegistry
 ↓
PermissionService
 ↓
Tool.execute()
```

危险操作：

```text
shell: rm -rf ...
```

先：

```text
Approve? [y/N]
```

再执行。

---

# 12. ask_user Tool

注册特殊 Tool：

```text
ask_user
```

例如：

```json
{
  "question": "文件应该保存在哪里？"
}
```

执行过程：

```text
LLM
 ↓
ask_user
 ↓
Agent Pause
 ↓
CLI Input
 ↓
Tool Result
 ↓
Agent Resume
```

它实际上证明 Agent Loop 支持：

```text
LLM
→ Environment
→ Human
→ Agent
```

而不是单纯：

```text
LLM → Tool
```

这是非常适合面试讲的功能。

---

# 13. Parallel Tool Calling

如果模型一次返回：

```text
read package.json
read README.md
read tsconfig.json
```

可以：

```ts
await Promise.all(...)
```

但并不是所有 Tool 都能并行。

建议 Tool Metadata：

```ts
parallelSafe: boolean
```

例如：

```text
read_file     true
write_file    false
shell         false
```

一期无需实现复杂 Scheduler。

---

# 14. 最终架构

完成第二阶段后：

```text
                   ┌──────────────┐
                   │     CLI      │
                   └──────┬───────┘
                          │
                    ┌─────▼─────┐
                    │ AgentLoop │
                    └─────┬─────┘
                          │
                     Context / DI
                  ┌───────┼─────────┐
                  │       │         │
                  ▼       ▼         ▼
               LLM     Tools    Permission
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
         read_file  write_file    shell
             │
             └────── ask_user
```

其中：

```text
AgentLoop = 控制策略
Context   = Runtime 依赖容器
Registry  = Tool 能力注册
Tool      = Agent 与环境之间的 Action
```

---

# 15. README 中重点讲的技术故事

不要写成：

> 我实现了一个 AI Coding Agent。

建议强调：

> 项目采用极简 Runtime + Dependency Injection 架构。Agent Loop 本身只负责模型调用和状态推进，不直接依赖具体 LLM 或 Tool 实现；运行时能力通过 Context 和 Tool Registry 注入，从而在保持实现简单的同时，使权限控制、交互工具和并行执行能够作为独立能力逐步扩展。

进一步可以说明：

```text
DSH / Pi Agent
        ↓
提取核心工程思想
        ↓
Context / Registry / Agent Loop
        ↓
Minimal Coding Agent
```

不是：

```text
Mini DeepSeek Harness
```

而是：

```text
DSH-inspired Minimal Agent Runtime
```

---

# 16. 开发时间预算

总时间控制在约 3 小时：

| 时间        | 内容                        |
| --------- | ------------------------- |
| 0:00–0:20 | 初始化仓库、类型、Context          |
| 0:20–0:50 | Tool Registry + 三个 Tool   |
| 0:50–1:30 | LLM Provider + Agent Loop |
| 1:30–1:50 | CLI + 两个 E2E Case         |
| 1:50–2:00 | README + 第一阶段 commit      |
| 2:00–2:30 | Permission                |
| 2:30–2:50 | ask_user                  |
| 2:50–3:00 | 测试、README、最终 commit       |

若时间不足：

```text
WebUI         不做
Parallel Tool 不做
```

优先保证：

```text
Agent Loop
+ DI
+ Tool Registry
+ Permission
+ ask_user
```

完整可演示。
