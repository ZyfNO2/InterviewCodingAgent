# Phase 4 前端 · Step 2 — Soul 面板 + 命令入口（/init、/plan）

对应后端：`10-Phase4-Step2-Soul-Prompt.md`（Soul/MemoryService/`/init`）与 `11` 的命令入口部分。
契约来源：`web/transport.js`。定位：前端可**并行**，Mock 先行。

---

## A. SPEC（做什么）

### A.1 契约扩展

`AgentEvent` 新增：

```ts
| { type: "soul"; action: "loaded" | "updated"; summary: string }   // Soul 载入/写入
| { type: "command"; command: "init" | "plan"; accepted: boolean; note?: string }
```

- `soul.summary`：一句话说明（如 "Loaded: prefers TypeScript, concise answers"）；面板可展开显示原文（可选由 summary 承载多行）。
- `command`：Runtime 确认某条命令已被路由处理（前端据此给出反馈，而非自己解释命令）。

### A.2 交付清单

- [ ] **命令识别**：输入以 `/` 开头时，输入栏进入"命令模式"视觉提示（如高亮/图标），但**不自行解析语义**，整行原样交给源（CommandRouter 在 Runtime 侧解析）。
- [ ] `/init` 与 `/init <content>`：发送后展示 `command(init)` 反馈 + 随后 `soul(updated)` 提示。
- [ ] `/plan <task>`：发送后进入计划流程（UI 细节在 `18`，本文只负责"命令被识别并发出"）。
- [ ] **Soul 面板**：一个可折叠面板/侧栏，显示当前 Soul 摘要；收到 `soul(loaded)` 时填充，`soul(updated)` 时刷新并高亮变更。
- [ ] Mock 剧本覆盖 `/init` 创建、`/init 偏好` 写入、Soul 载入影响后续任务的演示。

### A.3 非目标

- 前端不做 Soul 的编辑保存（写入是 Runtime 的事）；面板只读展示。
- 不在前端实现命令的业务分支（遵循"业务控制不写进前端"）。

---

## B. 设计（怎么做）

### B.1 命令模式（`app.js` / `index.html`）

- `taskInput` 监听 `input`：值以 `/` 开头 → 加 class（如 `.command-mode`）改边框色 + 显示小徽章 "COMMAND"。
- `sendTask()` 保持原样：整行文本交给 `activeSource.start(text)`；是否命令由 Runtime/Mock 判断。
- 可选：为 `/init`、`/plan` 提供输入提示占位符（纯 UX，不含解析逻辑）。

### B.2 Soul 面板

- 在 `index.html` 顶部控制区或右侧加一个折叠面板 `#soul-panel`（沿用现有卡片/变量样式）。
- `handleEvent` 增加：
  - `soul` → 更新面板内容；`updated` 时给面板一次高亮动画。
  - `command` → 在事件流插入一条轻量系统卡片（"Command accepted: /init" 之类）。

### B.3 Mock 侧（`mock.js`）

- 新增 `soul_init`：
  ```text
  message(user:/init Prefer TypeScript over Python)
  → command(init, accepted:true, note:"created .agent/SOUL.md")
  → soul(updated, summary:"Preferences: prefer TypeScript over Python")
  → done("Soul initialized.")
  ```
- 新增 `soul_effect`（对应 RPD Acceptance Case 3）：
  ```text
  soul(loaded, summary:"prefer TypeScript over Python")
  → message(user:create a small script)
  → assistant 选择 TypeScript → write_file(script.ts) → done
  ```
- `MockEventSource` 对 `/` 开头输入可返回对应剧本（或用剧本选择器手动切）。

### B.4 渲染映射（新增）

| 事件 | UI 表现 |
| --- | --- |
| `command` | 事件流一条系统提示卡（accepted 绿 / 拒绝红），显示 note |
| `soul.loaded` | Soul 面板填充摘要，状态徽章可提示 "Memory loaded" |
| `soul.updated` | Soul 面板刷新 + 高亮，事件流可加一条 "Soul updated" |

---

## C. 验收条件（Mock 优先）

- [ ] 输入 `/` 开头时进入命令模式视觉提示；普通任务无提示。
- [ ] `/init` 演示：出现 command 反馈 + Soul 面板出现/刷新内容。
- [ ] `soul_effect` 演示：Soul 载入后，新任务在无其他约束时倾向 TypeScript（UI 明确体现）。
- [ ] Soul 面板可折叠/展开，只读，不影响事件流。
- [ ] 不破坏既有 case1/2/3 与六类事件渲染；未知事件不崩。

## D. 与后端接线

- `soul`/`command` 由后端 Step 2/3 发出；`/init`、`/plan` 由 Runtime 的 CommandRouter 解析，前端只发原文。
- 切源仅改注入一行。
