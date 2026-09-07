# InterviewCodingAgent — Phase 4 RPD

## Session / Soul / Plan & Goal / Completion Control

## 1. 阶段目标

在现有 Minimal Coding Agent Runtime 上增加一层轻量的 **Agent Runtime Policy**，解决当前 Agent 的四个主要问题：

1. 不同任务之间没有连续 Session；
2. Agent 没有长期稳定记忆；
3. 复杂任务缺少显式 Plan / Goal 与人工执行确认；
4. 模型可以自行宣布完成，Runtime 缺乏完成检查与停滞控制。

最终形成：

```text
User / WebUI
      │
      ▼
Command Router
      │
      ▼
Agent Session
 ├── Messages
 ├── Goal
 ├── Plan
 └── Turn State
      │
      ▼
Context Assembly
 ├── System Prompt
 ├── Soul.md
 ├── Goal
 ├── Plan
 └── Session History
      │
      ▼
Agent Loop
      │
      ├── Tools
      ├── Progress Tracker
      └── Completion Gate
```

本阶段仍保持：

> Agent Loop 简单，控制能力尽量由外围 Policy / Service 提供。

---

# 2. 当前 Runtime 基线

现有实现已经包括：

```text
Agent Loop
Context / DI
Tool Registry
read_file
write_file
shell
ask_user
Permission Control
Parallel Tool Calling
JSONL Trace
Tool Result Context Truncation
CLI
WebUI / SSE
```

当前 Agent 的主要问题是：

```ts
run(task) {
  const messages = [
    system,
    user
  ]
}
```

每次 `run()` 都建立新的消息历史。

因此目前：

```text
CLI 连续输入
≠
真正连续 Session
```

本阶段首先修正这一点。

---

# 3. 设计原则

## 3.1 保持 Agent Loop 简洁

不要将：

```text
Memory
Plan
Goal
Session
Progress
Command Parsing
```

全部直接写入 `agent.ts`。

Agent Loop 仍只负责：

```text
LLM
→ Tool Calls
→ Tool Results
→ 状态推进
→ Final
```

---

## 3.2 Context 保持 DI Container 定位

继续保留：

```ts
ctx.provide(...)
ctx.resolve(...)
```

Context 负责服务注入：

```text
LLM
Tools
Permission
Memory
Session
```

但：

```text
ctx.messages
ctx.goal
ctx.plan
ctx.memoryFacts
```

不直接成为 Context 字段。

这些属于：

```text
AgentSession
```

---

## 3.3 Stable Prefix 优先

Prompt 顺序固定：

```text
1. SYSTEM_PROMPT
2. SOUL.md
3. Stable Project Instructions
------------------------------
4. Goal
5. Plan
6. Session History
7. Current User Input
```

稳定内容尽可能保持前置和顺序稳定。

目标：

```text
Stable Prefix
→ 更容易保持 Prompt / KV Cache 稳定
```

不在 System Prompt 前部加入：

```text
时间
随机 runtime 信息
动态 trace
当前 step
```

---

# 4. Phase 4A — Agent Session

## 4.1 目标

把：

```text
一次 run()
```

和：

```text
一个 Session
```

分开。

Session 可以承载连续多轮任务。

---

## 4.2 AgentSession

新增：

```text
src/core/session.ts
```

建议：

```ts
export interface AgentSession {
  id: string;

  messages: ChatMessage[];

  userTurns: number;

  goal?: AgentGoal;

  plan?: AgentPlan;

  progress: ProgressState;
}
```

Session 生命周期：

```text
create session
     ↓
user task
     ↓
agent.run(session, task)
     ↓
messages 保留
     ↓
user next task
     ↓
agent.run(sameSession, task)
```

---

## 4.3 Agent API

当前：

```ts
agent.run(task)
```

逐步调整为：

```ts
agent.run(session, task)
```

或：

```ts
agent.run({
  session,
  task
})
```

不再由 `Agent.run()` 每次重新创建完整 history。

---

## 4.4 Session 隔离

CLI 第一版：

```text
一个 CLI process
→ 一个 Session
```

WebUI：

```text
sessionId
→ AgentSession
```

不同 session：

```text
Session A messages
≠
Session B messages
```

不共享：

```text
Goal
Plan
Conversation History
Progress State
```

长期 Soul 可以共享。

---

# 5. Phase 4B — Soul.md

## 5.1 目标

增加稳定长期记忆：

```text
SOUL.md
```

用于保存：

```text
Agent Identity
User Preferences
Stable Facts
Working Conventions
```

不保存短期运行事实。

---

# 6. Soul 内容边界

推荐结构：

```md
# Soul

## Identity

## User Preferences

## Persistent Facts

## Working Conventions
```

允许：

```text
用户倾向 TypeScript
用户偏好简洁实现
项目强调 Agent Runtime
危险操作需要确认
```

不允许：

```text
刚刚执行 npm test
README 内容
本轮 shell 输出
当前 Plan
当前 Goal
```

这些仍属于 Session / Trace。

---

# 7. MemoryService

新增：

```text
src/core/memory.ts
```

接口：

```ts
interface MemoryService {
  loadSoul(): Promise<string>;

  saveSoul(content: string): Promise<void>;

  consolidate?(
    session: AgentSession
  ): Promise<void>;
}
```

第一实现：

```text
MarkdownMemoryService
```

文件位置建议：

```text
<workspace>/.agent/SOUL.md
```

避免直接污染用户项目根目录。

---

# 8. Soul 初始化

支持：

```text
/init
```

例如：

```text
/init
```

若 Soul 不存在：

```text
创建 .agent/SOUL.md
```

也可支持：

```text
/init Prefer concise TypeScript implementations
```

初始化基础偏好。

Command 层负责拦截，而不是交给 LLM 自己解释 `/init`。

---

# 9. Memory Consolidation

每：

```text
10 user turns
```

进行一次长期记忆沉淀。

注意：

```text
10 user turns
≠
10 agent steps
```

例如：

```text
User
→ LLM
→ read
→ LLM
→ shell
→ LLM
```

仍只算：

```text
1 user turn
```

---

## 9.1 Consolidation 输入

使用最近一段 Session：

```text
Recent User Messages
Recent Assistant Finals
Relevant Goal / Plan
```

不要将整个 Trace 全量发送。

---

## 9.2 Consolidation 输出

只抽取：

```text
stable facts
preferences
persistent conventions
```

结构化结果：

```json
{
  "facts": [],
  "preferences": [],
  "conventions": []
}
```

之后 merge 到：

```text
SOUL.md
```

---

## 9.3 去重

Memory Merge 时避免每十轮重复加入：

```text
Prefer TypeScript
Prefer TypeScript
Prefer TypeScript
```

第一版可以简单：

```text
normalize line
→ Set 去重
```

不实现复杂 Vector Memory。

---

# 10. Prompt Assembly

新增：

```text
src/agent/prompt.ts
```

把当前 `agent.ts` 中 SYSTEM Prompt 与未来动态 Prompt 拼接移入此处。

接口：

```ts
buildSystemPrompt({
  soul,
  goal,
  plan
})
```

最终：

```text
SYSTEM_PROMPT

# Persistent Memory
{Soul}

# Current Goal
{Goal}

# Current Plan
{Plan}
```

Agent Loop 不直接处理 Markdown 文件。

---

# 11. Phase 4C — Command Router

新增：

```text
src/core/command-router.ts
```

所有入口统一经过：

```text
CLI ───┐
       ├── CommandRouter → Runtime
Web ───┘
```

避免：

```text
CLI 支持 /plan
WebUI 不支持
```

---

# 12. Command 类型

第一版支持：

```text
/plan
/init
```

以后可以扩：

```text
/new
/status
/memory
```

本阶段不实现非必要命令。

建议类型：

```ts
type UserCommand =
  | {
      type: "task";
      task: string;
    }
  | {
      type: "plan";
      task: string;
    }
  | {
      type: "init";
      content?: string;
    };
```

Regex 只负责解析：

```text
/plan xxx
/init xxx
```

业务控制不写进 Regex。

---

# 13. Phase 4D — Goal

Goal 描述：

> Agent 最终需要达到什么状态。

例如：

```ts
interface AgentGoal {
  description: string;

  acceptanceCriteria: string[];
}
```

示例：

```yaml
Goal:
  description:
    Create hello.py

  acceptanceCriteria:
    - file exists
    - running python hello.py succeeds
    - stdout contains "Hello Coding Agent"
```

Goal：

```text
相对稳定
```

Plan：

```text
允许修改
```

---

# 14. Phase 4E — Plan Mode

用户输入：

```text
/plan implement X
```

Runtime：

```text
CommandRouter
     ↓
Planner
     ↓
Goal + Plan
     ↓
Approval Gate
     ↓
Executor
```

---

# 15. Planner

新增：

```text
src/core/planner.ts
```

Planner 负责生成：

```text
Goal
Plan
Acceptance Criteria
Risks
```

推荐输出：

```md
## Goal

## Acceptance Criteria

## Plan
1.
2.
3.

## Risks
```

---

# 16. Plan 阶段工具权限

Plan 阶段原则：

```text
Read many
Write nothing
```

允许：

```text
read_file
```

可选允许：

```text
safe shell inspection
```

第一版为了简单可以只开放：

```text
read_file
```

禁止：

```text
write_file
dangerous shell
```

Planner 必须能调查真实仓库，但不能修改。

---

# 17. Approval Gate

Plan 生成后：

```text
Plan
 ↓
User Approval
```

支持：

```text
approve
reject
revise
```

Runtime 必须保证：

```text
/plan mode
→ 未 approve
→ 不允许执行副作用工具
```

这个审批是 Runtime Gate。

不要实现成：

```text
LLM 自己决定什么时候 ask_user
```

---

# 18. Plan 执行

Approve 后：

```text
session.goal = goal
session.plan = plan
```

然后进入正常：

```text
Agent Loop
```

Prompt 自动获得：

```text
Current Goal
Current Plan
```

Plan 可以因为执行情况更新。

Goal 默认不修改。

---

# 19. Phase 4F — Completion Gate

当前 Agent：

```text
LLM final
→ Runtime final
```

本阶段修改为：

```text
LLM final
    ↓
Need Completion Check?
    ↓
Verifier
    ↓
complete?
 ┌──┴──┐
Yes   No
 │      │
Final  Feedback
        │
        └→ Agent Loop
```

---

# 20. Completion Check 触发规则

不要所有普通问题都增加第二次 LLM 调用。

配置：

```ts
completionCheck:
  | "off"
  | "plan-only"
  | "always"
```

默认：

```text
plan-only
```

也就是说：

```text
普通对话
→ 模型 final 即返回

/plan complex task
→ final 前执行 Completion Check
```

---

# 21. Completion Verifier

输入：

```text
Goal
Acceptance Criteria
Plan
Recent Tool Facts
Proposed Final Answer
```

输出固定 Schema：

```json
{
  "complete": false,
  "reason": "The generated script was never executed.",
  "remaining": [
    "Run the script",
    "Verify expected output"
  ]
}
```

---

# 22. Incomplete 回灌

如果：

```text
complete = false
```

向当前 Session 加：

```text
Completion verification failed.

Remaining:
- ...
```

继续 Agent Loop。

Verifier 不直接执行 Tool。

---

# 23. Completion Check 上限

防止：

```text
Agent
→ final
→ verifier reject
→ Agent
→ final
→ verifier reject
→ ...
```

增加：

```text
maxCompletionChecks = 2
```

超过：

```text
stopReason = completion_check_limit
```

返回明确状态。

---

# 24. Phase 4G — Progress Tracker

新增：

```text
src/core/progress.ts
```

目的：

```text
识别重复动作
识别无新增信息
防止 Agent 原地重试
```

---

# 25. Progress Signal

以下任意情况视为有新进展：

```text
成功读取新的文件
成功写入新的文件
得到新的 shell 输出
新的 Tool Result
Goal remaining items 减少
Completion Check remaining items 减少
```

---

# 26. Tool Fingerprint

第一版使用：

```text
hash(
  toolName +
  normalizedArgs +
  normalizedResult
)
```

维护：

```ts
seenToolResults: Set<string>
```

若：

```text
相同 Tool
+
相同 Args
+
相同 Result
```

重复出现：

```text
不算 progress
```

---

# 27. Stall Detection

建议：

```text
maxStallRounds = 3
```

连续无新增 progress：

### 第一次达到阈值

注入：

```text
You appear to be repeating actions without new information.
Re-evaluate the current approach before making another tool call.
```

允许 Agent 自我纠正一次。

再次持续 Stall：

```text
stopReason = "stalled"
```

停止执行。

---

# 28. Runtime Budget

扩展现有：

```text
maxSteps
```

为：

```ts
interface AgentBudget {
  maxSteps: number;

  maxCompletionChecks: number;

  maxStallRounds: number;
}
```

建议默认：

```text
maxSteps            = 20
maxCompletionChecks = 2
maxStallRounds       = 3
```

---

# 29. Token / Cost Budget

本阶段：

```text
不作为 P0
```

当前 LLM Provider 尚未向 Runtime 返回 usage 信息，因此暂时不为 Token Budget 修改整个 Provider API。

后续可扩：

```text
promptTokens
completionTokens
totalTokens
estimatedCost
```

现在仍以：

```text
maxSteps
maxCompletionChecks
stall limit
```

作为主要资源边界。

---

# 30. Runtime State

最终 Session：

```ts
interface AgentSession {
  id: string;

  messages: ChatMessage[];

  userTurns: number;

  goal?: AgentGoal;

  plan?: AgentPlan;

  progress: {
    seenResults: Set<string>;
    stallRounds: number;
    completionChecks: number;
  };
}
```

---

# 31. 最终流程

```text
                         User
                           │
                           ▼
                    Command Router
                    /      |      \
                  task   /plan   /init
                   │       │       │
                   │    Planner   Soul
                   │       │
                   │     Goal
                   │     Plan
                   │       │
                   │   Approval
                   │       │
                   └───┬───┘
                       ▼
                 Agent Session
           ┌───────────┼───────────┐
           │           │           │
        Messages      Goal        Plan
           │
           ▼
                Prompt Assembly
           ┌───────────┼───────────┐
           │           │           │
         System       Soul      Goal/Plan
           │
           ▼
                    Agent Loop
                       │
                     LLM
                       │
                   Tool Calls
                       │
                  Tool Registry
                       │
                Progress Tracker
                       │
                       ▼
                    LLM Final
                       │
                Completion Gate
                  /           \
             complete       incomplete
                │               │
              Final        feedback
                                │
                                └──→ Agent Loop
```

---

# 32. 文件结构

建议最终：

```text
src/
├── agent/
│   ├── agent.ts
│   ├── prompt.ts
│   └── types.ts
│
├── core/
│   ├── context.ts
│   ├── context-manager.ts
│   ├── session.ts
│   ├── memory.ts
│   ├── command-router.ts
│   ├── planner.ts
│   ├── progress.ts
│   ├── permission.ts
│   └── trace.ts
│
├── tools/
├── llm/
├── cli/
└── web/
```

不要继续拆：

```text
MemoryRegistry
PolicyRegistry
SessionManagerFactory
PlannerFactory
CompletionPipeline
```

当前规模不需要。

---

# 33. Trace 扩展

现有 Trace 继续作为 Runtime 事实记录。

增加事件：

```text
session_start
session_turn

plan_start
plan_generated
plan_approved
plan_rejected

memory_loaded
memory_consolidated

completion_check
completion_rejected

stall_warning
early_stop
```

继续保持原则：

```text
Trace = 完整运行事实

Context = 当前模型真正需要的信息
```

已有 Tool Result 截断也继续遵循这一原则：完整结果进入 Trace，截断结果进入 LLM Context。

---

# 34. 实施顺序

## Step 1 — Session

实现：

```text
AgentSession
agent.run(session, task)
CLI session persistence
Web session isolation
```

验收后再进行下一项。

---

## Step 2 — Prompt / Soul

实现：

```text
prompt.ts
MemoryService
SOUL.md load
/init
stable prefix
```

---

## Step 3 — Plan / Goal

实现：

```text
CommandRouter
/plan
Planner
Goal
Plan
Approval Gate
```

---

## Step 4 — Completion Gate

实现：

```text
Verifier
Structured Result
Incomplete Feedback
maxCompletionChecks
```

---

## Step 5 — Progress / Early Stop

实现：

```text
Tool fingerprint
Progress state
Stall warning
Early stop
```

---

## Step 6 — Memory Consolidation

最后实现：

```text
10 user turns
→ extract stable memory
→ merge SOUL.md
```

这项不应阻塞前五项验收。

---

# 35. Acceptance Case 1 — Session

输入：

```text
User:
Create hello.ts.

User:
Now run the file you created.
```

第二个 Turn 应知道：

```text
hello.ts
```

来自上一轮 Session。

PASS：

```text
没有要求用户再次解释文件
且 Session history 被正确保留
```

---

# 36. Acceptance Case 2 — Session Isolation

建立：

```text
Session A
Session B
```

A：

```text
Create secret-a.txt
```

B：

```text
What file did I just create?
```

B 不应继承：

```text
secret-a.txt
```

的 Conversation Context。

---

# 37. Acceptance Case 3 — Soul

Soul：

```text
Prefer TypeScript over Python.
```

新 Session：

```text
Create a small script.
```

Agent 在没有其他约束时应优先选择：

```text
TypeScript
```

证明长期偏好跨 Session 存在。

---

# 38. Acceptance Case 4 — Plan Approval

输入：

```text
/plan add a calculator CLI
```

应：

```text
inspect
→ output Goal
→ output Plan
→ ask approval
```

批准前：

```text
不得 write_file
不得 destructive shell
```

批准后才能执行。

---

# 39. Acceptance Case 5 — Goal / Plan

计划：

```text
1. inspect files
2. implement
3. run tests
```

若实际发现测试命令不同：

```text
Plan 可以修改
```

但：

```text
Goal 不改变
```

---

# 40. Acceptance Case 6 — Completion Gate

Task：

```text
Create hello.py and verify that it runs.
```

Agent 如果只：

```text
write_file
→ final
```

Verifier 应：

```json
{
  "complete": false,
  "remaining": [
    "run hello.py"
  ]
}
```

Agent 必须继续执行验证。

---

# 41. Acceptance Case 7 — Early Stop

Mock Agent 连续三次：

```text
read same file
→ same result
```

应触发：

```text
stall warning
```

继续重复：

```text
early_stop
```

而不是一直跑到 `maxSteps`。

---

# 42. Acceptance Case 8 — Memory Consolidation

连续：

```text
10 user turns
```

其中用户稳定表达：

```text
Prefer concise answers.
```

Consolidation 后：

```text
SOUL.md
```

应存在相应 Preference。

临时信息：

```text
刚刚执行了 npm test
```

不得写入长期 Soul。

---

# 43. Tests

新增建议：

```text
tests/
├── session.test.ts
├── memory.test.ts
├── command-router.test.ts
├── planner.test.ts
├── completion.test.ts
└── progress.test.ts
```

必须覆盖：

```text
Session history
Session isolation
Soul load
Soul merge
/plan parsing
approval gate
completion reject
completion accept
completion limit
stall detection
```

现有 Agent / Tool / Provider 测试不得破坏。

---

# 44. Non-Goals

本阶段明确不做：

```text
Vector Memory
RAG Memory
Semantic Memory Search
Multi-Agent
SubAgent
复杂 Planner Graph
完整 Event Sourcing
Database Persistence
Distributed Session
Token-level Context Compression
自动 Task Decomposition Tree
完整 DSH Plugin Lifecycle
```

---

# 45. 开发 Commit 建议

不要一次全部提交。

建议：

```text
feat: add persistent agent sessions

feat: add soul memory and stable prompt assembly

feat: add plan mode with goal and approval gate

feat: add completion verification

feat: add progress tracking and early stop

feat: add periodic soul consolidation
```

这样录屏和 Reviewer 都能明确看到 Runtime 是如何逐步演进的。

---

# 46. 优先级

```text
P0
Session
Soul static injection
/plan
Goal
Approval Gate

P1
Completion Check
Early Stop

P2
10-turn Memory Consolidation

P3
Token / Cost Budget
```

如果笔试时间已经明显超出：

```text
做到 P1 即停止。
```

自动 Memory Consolidation 可以放在 README 的 Extension / Future Work 中。

---

# 47. 本阶段完成定义

阶段完成至少满足：

```text
✓ 连续任务共享 Session

✓ 不同 Session 隔离

✓ SOUL.md 可初始化并进入稳定 Context Prefix

✓ /plan 能生成 Goal + Plan

✓ 用户批准前没有副作用执行

✓ 批准后 Agent 可以根据 Plan 执行

✓ 模型 Final 可以被 Completion Gate 驳回

✓ Agent 停滞时能够收到重新规划提示并最终早停

✓ maxSteps 仍然作为最终硬限制

✓ 原有 Permission / ask_user / Parallel / Trace / WebUI 不回归
```

最终得到的不是一个复杂 Agent Framework，而是：

```text
Minimal Agent Runtime
        +
Lightweight Runtime Policy
```

即：

```text
Execution
Session
Memory
Planning
Human Gate
Completion
Progress Control
```

形成一个完整但仍然容易 Review 的 Coding Agent Harness。
