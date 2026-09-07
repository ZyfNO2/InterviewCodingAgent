# Minimal Coding Agent — 开发计划总览

本目录按阶段拆分开发计划，每个阶段文档包含三部分：

- **SPEC**：本阶段要做什么、接口契约、行为约定。
- **设计**：如何实现、模块划分、关键取舍。
- **验收条件**：可验证的完成标准（Definition of Done）。

## 文档索引

| 文档 | 阶段 | 目标 |
| --- | --- | --- |
| `01-Phase1-Minimal-Runtime.md` | 阶段一 (P0) | 最小可运行 Coding Agent Runtime |
| `02-Phase2-Extensions.md` | 阶段二 | Permission / ask_user / Parallel Tool |
| `03-Phase3-Testing-Delivery.md` | 阶段三 | 测试、验证与最终交付 |
| `04-Phase4-WebUI.md` | 阶段四 (可选 P2) | WebUI 演示层（前端，Mock 优先，可并行） |
| `05-LLM-Config.md` | 配置附录 | LLM 端点 / 模型 / 环境变量约定 |
| `06-Integration-WebUI-Backend.md` | 接线阶段 (可选) | 前端 ↔ 后端 Runtime 端到端联调 |
| `07-Concurrency-Context-Design.md` | 进阶设计 (可选) | 有限并发执行池 + Context 管理（非长期 Memory） |

## 技术故事定位

> DSH-inspired **Minimal Agent Runtime**，不是 Mini DeepSeek Harness。

提取 DSH 的核心工程思想（Context / Registry / Agent Loop），压缩到笔试最小规模：

```text
DSH / Pi Agent
      ↓  提取核心工程思想
Context / Registry / Agent Loop
      ↓
Minimal Coding Agent
```

## 技术选型

```text
TypeScript + Node.js
OpenAI-compatible SDK
Zod (Tool Schema)
readline (CLI 交互)
dotenv (配置)
```

## 顶层架构

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
                  ▼       ▼         ▼
               LLM     Tools    Permission
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
         read_file  write_file    shell
             │
             └────── ask_user
```

角色划分：

```text
AgentLoop = 控制策略（模型调用 + 状态推进）
Context   = Runtime 依赖容器（DI）
Registry  = Tool 能力注册与 Schema 导出
Tool      = Agent 与环境之间的 Action
```

## 关键全局约定

1. **消息格式**遵循 OpenAI function calling：`assistant.tool_calls` + `role:"tool"` + `tool_call_id`，保证多轮闭环。
2. **错误不崩溃**：工具失败以结构化 `ToolResult{ ok:false }` 回灌模型，让 Agent 有机会自我纠正。
3. **路径约束**：所有文件工具基于 `ctx.workspace` 解析，拒绝逃逸出 workspace。
4. **交互收敛**：Permission 与 ask_user 复用同一个 CLI readline 交互层。
5. **maxSteps 兜底**：Agent Loop 必须有步数上限，默认 20。

## 开发时间预算（约 3 小时）

| 时间 | 内容 |
| --- | --- |
| 0:00–0:20 | 初始化仓库、类型、Context |
| 0:20–0:50 | Tool Registry + 三个 Tool |
| 0:50–1:30 | LLM Provider + Agent Loop |
| 1:30–1:50 | CLI + 两个 E2E Case |
| 1:50–2:00 | README + 阶段一 commit |
| 2:00–2:30 | Permission |
| 2:30–2:50 | ask_user |
| 2:50–3:00 | 测试、README、最终 commit |
