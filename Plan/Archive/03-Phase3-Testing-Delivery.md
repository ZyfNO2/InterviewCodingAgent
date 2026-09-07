# 阶段三 — 测试、验证与交付

目标：把阶段一/二的实现固化为可重复验证的质量门禁，并完成 README 与最终交付。
定位：这是"收敛阶段"，不新增业务能力，专注可验证性、健壮性与交付物。

前置条件：阶段一、阶段二的功能验收条件均已通过。

---

## A. SPEC（做什么）

### A.1 交付清单

- [ ] 单元测试：Registry / 三个 Tool / 路径约束 / LLM 响应解析
- [ ] 集成测试：Agent Loop（用可注入的 Mock LLM 驱动多轮）
- [ ] E2E 冒烟：真实端点跑通 Case 1 / Case 2（手动或脚本，可跳过 CI）
- [ ] 错误与边界用例覆盖
- [ ] README 完整化（含技术故事、架构图、运行说明、演示）
- [ ] `.env.example` 校准到真实端点占位
- [ ] 最终 commit

### A.2 测试分层约定

| 层级 | 对象 | 是否需要真实模型 |
| --- | --- | --- |
| 静态检查 | tsc / lint | 否 |
| 单元测试 | Tool、Registry、路径校验、schema 解析 | 否 |
| 集成测试 | Agent Loop（Mock LLM） | 否（用假 Provider） |
| E2E 冒烟 | CLI + 真实端点 | 是（`gemini-3.8-flash-medium`） |

> 原则："mock 测试通过" ≠ "真实 provider 可用"；E2E 冒烟必须至少手动跑一次。

---

## B. 设计（怎么做）

### B.1 测试框架

- 采用 `vitest`（轻量、TS 友好、零额外配置）。
- 目录：`tests/`，与 `src/` 平行。

### B.2 Mock LLM Provider（集成测试关键）

- 关键设计：`LLMProvider` 是 Context 注入的接口，测试时注入一个脚本化的 Mock：
  ```ts
  // 预设一串响应队列，逐轮返回，驱动 Agent Loop 而不触网
  class ScriptedLLM implements LLMProvider {
    constructor(private script: LLMResponse[]) {}
    async chat() { return this.script.shift()!; }
  }
  ```
- 用它验证：
  - tool_calls → 执行 → 结果回灌 → 再次 final 的完整闭环；
  - 多轮（write_file 然后 shell 然后 final）；
  - maxSteps 触发；
  - 工具报错回灌后 Loop 不崩溃。

### B.3 单元测试要点

- `read_file`：读存在文件成功；读不存在文件返回 `ok:false`；越权路径被拒。
- `write_file`：新建含子目录文件成功；越权路径被拒。
- `shell`：正常命令返回 stdout；非零退出码体现在 output；越权/超时处理。
- `Registry`：重名注册报错；`toLLMSchema()` 结构正确；未知工具名执行返回 `ok:false`。
- `Provider` 解析：`tool_calls` 与 `final` 两态解析正确；坏 JSON arguments 的处理。

### B.4 验证门禁（Verification Gate）

结束前逐项确认：

1. 需求满足？（两个 Case 链路正确）
2. 测试执行并通过？（单元 + 集成）
3. 回归检查？（阶段二能力未破坏阶段一）
4. Diff 审查？（无无关文件改动、无调试残留、无密钥泄漏）
5. 遗留假设标注？（未验证项在 README/交付说明中明示）

---

## C. 验收条件

### C.1 自动化测试

- [ ] `npm test` 全绿（vitest 单元 + 集成）。
- [ ] `npm run build` 无类型错误。
- [ ] 集成测试用 Mock LLM 覆盖：单轮 final、多轮 tool loop、maxSteps、工具错误回灌。

### C.2 E2E 冒烟（真实端点）

- [ ] Case 1（总结文件）真实跑通。
- [ ] Case 2（建 hello.py → 运行 → 汇报）真实跑通。
- [ ] 记录一次真实运行日志片段（放 README 或 `docs/`）。

### C.3 交付物

- [ ] `README.md`：安装、`.env` 配置、运行命令、两个 Case 演示、架构图、技术故事。
- [ ] `.env.example`：端点/模型/密钥占位（不含真实密钥）。
- [ ] `.gitignore`：忽略 `.env`、`node_modules`、构建产物。
- [ ] 密钥不入库（真实 key 只在本地 `.env`）。
- [ ] 最终 commit 提交。

### C.4 安全自检

- [ ] 仓库无真实密钥（grep 检查 `sk-`）。
- [ ] `.env` 已被忽略。
- [ ] shell 工具的执行边界（cwd 约束、超时）在 README 中说明其风险与 Permission 缓解。
