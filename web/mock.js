/**
 * Mock 剧本库
 * 涵盖：
 * - 基础基线：Case 1 (读取分析), Case 2 (写文件/Shell/权限), Case 3 (异常与自我纠错)
 * - Phase 4 Step 1 (Session): session_case1 (多轮连续记忆), session_iso (会话隔离)
 * - Phase 4 Step 2 (Soul & Command): soul_init (/init 创建), soul_effect (Soul 偏好注入)
 * - Phase 4 Step 3 (Plan & Goal): plan_approve (批准并执行副作用), plan_reject (驳回且无副作用), plan_revise (修改重新规划)
 * - Phase 4 Step 4/5/6 (Runtime Status): completion_gate (完成校验驳回与补做), early_stop_stall (停滞熔断早停), memory_consolidate (记忆沉淀)
 */

export const mockScenarios = {
  /**
   * Case 1：总结分析指定文件
   * 对应场景：read_file -> 助手回答 -> 最终完成
   */
  case1: (task) => [
    {
      type: 'message',
      role: 'assistant',
      content: `收到任务。我将首先读取并分析 workspace 中的核心配置文件以了解项目架构。`,
    },
    {
      type: 'tool_call',
      id: 'call_rf_001',
      name: 'read_file',
      args: { path: 'package.json' },
    },
    {
      type: 'tool_result',
      id: 'call_rf_001',
      name: 'read_file',
      ok: true,
      result: JSON.stringify(
        {
          name: 'minimal-coding-agent',
          version: '0.1.0',
          description: 'Minimal Coding Agent Runtime: Context / Tool Registry / Agent Loop',
          type: 'module',
          dependencies: {
            dotenv: '^17.2.1',
            openai: '^5.10.1',
            zod: '^3.25.76',
            'zod-to-json-schema': '^3.24.5',
          },
          devDependencies: {
            '@types/node': '^24.0.0',
            typescript: '^5.8.3',
          },
        },
        null,
        2
      ),
    },
    {
      type: 'message',
      role: 'assistant',
      content: `已成功读取 \`package.json\`。项目采用 TypeScript + Node.js 构建，依赖 OpenAI SDK 作为核心 LLM Client，借助 Zod 进行工具 Schema 校验与格式转换。`,
    },
    {
      type: 'done',
      text: `【分析完成】\n1. 核心架构：基于 Context / Registry / Agent Loop 的轻量最小运行时。\n2. 语言栈：TypeScript (ESModule, Node >= 18)。\n3. 核心依赖：openai、zod、dotenv。`,
    },
  ],

  /**
   * Case 2：代码创建、高危权限审批、命令执行与用户追问
   * 涵盖：write_file -> permission 审批 -> shell -> ask_user -> done
   */
  case2: (task) => [
    {
      type: 'message',
      role: 'assistant',
      content: `准备生成计算斐波那契数列的脚本并运行验证。`,
    },
    {
      type: 'tool_call',
      id: 'call_wf_002',
      name: 'write_file',
      args: {
        path: 'scripts/fib.js',
        content: `function fib(n) {\n  return n <= 1 ? n : fib(n - 1) + fib(n - 2);\n}\nconsole.log("Fib(10) =", fib(10));\n`,
      },
    },
    {
      type: 'tool_result',
      id: 'call_wf_002',
      name: 'write_file',
      ok: true,
      result: `Successfully wrote 112 bytes to scripts/fib.js`,
    },
    {
      type: 'ask',
      id: 'ask_perm_001',
      kind: 'permission',
      question: `Agent 申请执行高危 Shell 命令：\`node scripts/fib.js\`，是否批准执行？`,
    },
    {
      type: 'tool_call',
      id: 'call_sh_003',
      name: 'shell',
      args: { command: 'node scripts/fib.js' },
    },
    {
      type: 'tool_result',
      id: 'call_sh_003',
      name: 'shell',
      ok: true,
      result: `Fib(10) = 55\n[Process exited with code 0]`,
    },
    {
      type: 'ask',
      id: 'ask_user_002',
      kind: 'ask_user',
      question: `脚本执行成功（结果为 55）。是否需要保留生成的测试脚本文件？(yes/no)`,
    },
    {
      type: 'message',
      role: 'assistant',
      content: `已确认用户意图，保留脚本文件。本次任务顺利闭环。`,
    },
    {
      type: 'done',
      text: `【执行完成】\n- 脚本 \`scripts/fib.js\` 写入成功\n- 权限确认流程通过\n- 命令 \`node scripts/fib.js\` 执行输出：\`Fib(10) = 55\`\n- 用户确认：保留测试文件`,
    },
  ],

  /**
   * Case 3：异常与自我修复剧本
   * 对应场景：工具报错返回 ok: false -> 自动重试修正 -> 成功
   */
  case3: (task) => [
    {
      type: 'message',
      role: 'assistant',
      content: `尝试读取目标代码文件。`,
    },
    {
      type: 'tool_call',
      id: 'call_err_001',
      name: 'read_file',
      args: { path: 'non_existent_file.ts' },
    },
    {
      type: 'tool_result',
      id: 'call_err_001',
      name: 'read_file',
      ok: false,
      result: `Error: ENOENT: no such file or directory, open 'non_existent_file.ts'`,
    },
    {
      type: 'message',
      role: 'assistant',
      content: `捕获到文件不存在错误。现在改为先列出 workspace 目录内容进行确认。`,
    },
    {
      type: 'tool_call',
      id: 'call_sh_004',
      name: 'shell',
      args: { command: 'ls -F src/' },
    },
    {
      type: 'tool_result',
      id: 'call_sh_004',
      name: 'shell',
      ok: true,
      result: `agent/\ncli/\ncore/\nindex.ts\nllm/\ntools/`,
    },
    {
      type: 'done',
      text: `【自我纠错闭环】模型通过错误回灌识别了不存在的路径，并成功自适应探测了可用目录结构。`,
    },
  ],

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 1: Session 连续对话与会话隔离
  // ─────────────────────────────────────────────────────────────

  /**
   * Session Case 1: 连续多轮交互记忆
   * Turn 1: 创建 hello.ts
   * Turn 2: 运行上一轮创建的文件（助手直接引用 hello.ts，绝无二次询问）
   */
  session_case1: (task, ctx) => {
    const sessionId = ctx?.sessionId || 'sess-session-1';
    const turn = ctx?.turn || 1;

    if (turn === 1) {
      return [
        { type: 'session_start', sessionId, title: '连续会话演示 - 第一轮' },
        { type: 'session', sessionId, userTurns: 1 },
        {
          type: 'message',
          role: 'assistant',
          content: `收到第一轮任务。我将创建 \`src/hello.ts\` 文件。`,
        },
        {
          type: 'tool_call',
          id: 'call_wf_s1_001',
          name: 'write_file',
          args: {
            path: 'src/hello.ts',
            content: `console.log("Hello from persistent session!");\n`,
          },
        },
        {
          type: 'tool_result',
          id: 'call_wf_s1_001',
          name: 'write_file',
          ok: true,
          result: `Successfully wrote 51 bytes to src/hello.ts`,
        },
        {
          type: 'done',
          text: `【第一轮完成】已创建 \`src/hello.ts\`。会话上下文已保留，您可以直接发送命令“运行刚才创建的文件”。`,
        },
      ];
    }

    // Turn 2
    return [
      { type: 'session_turn', sessionId, turn: 2 },
      { type: 'session', sessionId, userTurns: 2 },
      {
        type: 'message',
        role: 'assistant',
        content: `检测到会话上下文延续：上一轮创建了 \`src/hello.ts\`。直接运行该文件验证，无需再次询问文件名。`,
      },
      {
        type: 'tool_call',
        id: 'call_sh_s1_002',
        name: 'shell',
        args: { command: 'node --loader ts-node/esm src/hello.ts' },
      },
      {
        type: 'tool_result',
        id: 'call_sh_s1_002',
        name: 'shell',
        ok: true,
        result: `Hello from persistent session!\n[Process exited with code 0]`,
      },
      {
        type: 'done',
        text: `【第二轮完成】成功运行上一轮产物 \`src/hello.ts\`，证明 Session 跨轮次上下文连续记忆无损。`,
      },
    ];
  },

  /**
   * Session Case 2: 会话隔离演示
   * 在当前 session-A 中创建敏感私有文件 secret-a.txt
   * 验证切换/新建会话后不会残留
   */
  session_iso: (task, ctx) => {
    const sessionId = ctx?.sessionId || 'sess-iso-A';
    return [
      { type: 'session_start', sessionId, title: '隔离演示会话 A' },
      { type: 'session', sessionId, userTurns: 1 },
      {
        type: 'message',
        role: 'assistant',
        content: `在当前会话 [${sessionId}] 中生成私有凭据文件 \`secret-a.txt\`。`,
      },
      {
        type: 'tool_call',
        id: 'call_wf_iso_001',
        name: 'write_file',
        args: {
          path: 'secret-a.txt',
          content: `SECRET_KEY_A=mock-token-98831\n`,
        },
      },
      {
        type: 'tool_result',
        id: 'call_wf_iso_001',
        name: 'write_file',
        ok: true,
        result: `Successfully wrote 30 bytes to secret-a.txt`,
      },
      {
        type: 'done',
        text: `【会话 A 结束】已写入 \`secret-a.txt\`。请点击右上角「新建会话」以启动独立的 Session B，验证旧视图和上下文被物理隔离清空。`,
      },
    ];
  },

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 2: Soul 人设与命令入口 (/init)
  // ─────────────────────────────────────────────────────────────

  /**
   * Soul Case 1: /init 建立人设
   * 触发 command(init) + soul(updated)
   */
  soul_init: (task) => [
    {
      type: 'command',
      command: 'init',
      accepted: true,
      note: 'Command accepted: Created and initialized .agent/SOUL.md',
    },
    {
      type: 'soul',
      action: 'updated',
      summary: 'Preferences: Prefer TypeScript over Python; Always write modular code with strict typing; Concise answers.',
    },
    {
      type: 'message',
      role: 'assistant',
      content: `已成功执行 \`/init\`。人设灵魂文件已写入 \`.agent/SOUL.md\`，长期开发偏好已生效：优先使用 TypeScript、注重类型严谨性与精简高效的代码回答。`,
    },
    {
      type: 'done',
      text: `【/init 完成】Soul 人设文件与内存偏好已更新，顶部 Soul 状态面板已同步刷新。`,
    },
  ],

  /**
   * Soul Case 2: Soul 记忆影响后续行为
   * 载入 soul(loaded) -> 用户仅说“写一个小脚本” -> 助手根据偏好自动选择 TypeScript
   */
  soul_effect: (task) => [
    {
      type: 'soul',
      action: 'loaded',
      summary: 'Loaded from SOUL.md: Prefer TypeScript over Python; concise style.',
    },
    {
      type: 'message',
      role: 'assistant',
      content: `根据已加载的 Soul 偏好（“Prefer TypeScript over Python”），在未指定语言时，自动选择 TypeScript 编写高性能工具脚本。`,
    },
    {
      type: 'tool_call',
      id: 'call_wf_soul_001',
      name: 'write_file',
      args: {
        path: 'src/utils/counter.ts',
        content: `export class Counter {\n  private count = 0;\n  inc(): number { return ++this.count; }\n  get value(): number { return this.count; }\n}\n`,
      },
    },
    {
      type: 'tool_result',
      id: 'call_wf_soul_001',
      name: 'write_file',
      ok: true,
      result: `Successfully wrote 120 bytes to src/utils/counter.ts`,
    },
    {
      type: 'done',
      text: `【执行完成】已遵循 SOUL.md 人设偏好自动使用 TypeScript 实现 \`src/utils/counter.ts\`，无需用户额外声明。`,
    },
  ],

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 3: Plan & Goal 规划与审批 Gate (/plan)
  // ─────────────────────────────────────────────────────────────

  /**
   * Plan Approve: 计划提出与批准执行
   * 核心约束：在 approve 之前绝对无 write/shell 等副作用工具调用！
   */
  plan_approve: (task) => [
    {
      type: 'command',
      command: 'plan',
      accepted: true,
      note: 'Command accepted: Planning mode active. Generating Goal and Structured Plan.',
    },
    {
      type: 'goal',
      description: '为项目实现一个轻量命令行计算器 (Calculator CLI)',
      acceptanceCriteria: [
        '支持 add 与 sub 基本算术子命令',
        '参数校验与友好的错误格式输出',
        '编写测试脚本并通过自动化验证',
      ],
    },
    {
      type: 'plan',
      status: 'proposed',
      steps: [
        '步骤 1: 设计 CLI 参数解析器结构并定义 TypeScript 接口',
        '步骤 2: 编写 src/cli/calc.ts 实现核心逻辑',
        '步骤 3: 使用 shell 执行 ts-node 运行测试用例',
      ],
      risks: [
        '输入非数字字符可能引发解析崩溃',
        '命令行参数溢出',
      ],
    },
    {
      type: 'ask',
      id: 'ask_plan_app_001',
      kind: 'plan_approval',
      question: 'Agent 已经拟定执行方案与验收目标。请审阅 Plan 并决定是否批准执行副作用操作。',
    },
    // 注意：在 approve 之后由 MockEventSource 恢复并继续发出以下事件：
    {
      type: 'tool_call',
      id: 'call_wf_plan_001',
      name: 'write_file',
      args: {
        path: 'src/cli/calc.ts',
        content: `export function calc(op: string, a: number, b: number): number {\n  if (op === 'add') return a + b;\n  if (op === 'sub') return a - b;\n  throw new Error('Unsupported op: ' + op);\n}\nconsole.log("Calc result (add 15 25):", calc('add', 15, 25));\n`,
      },
    },
    {
      type: 'tool_result',
      id: 'call_wf_plan_001',
      name: 'write_file',
      ok: true,
      result: `Successfully wrote 240 bytes to src/cli/calc.ts`,
    },
    {
      type: 'tool_call',
      id: 'call_sh_plan_002',
      name: 'shell',
      args: { command: 'node --loader ts-node/esm src/cli/calc.ts' },
    },
    {
      type: 'tool_result',
      id: 'call_sh_plan_002',
      name: 'shell',
      ok: true,
      result: `Calc result (add 15 25): 40\n[Process exited with code 0]`,
    },
    {
      type: 'done',
      text: `【计划执行闭环】方案已获批准，按计划步骤完成了 \`src/cli/calc.ts\` 编写与测试运行，满足所有验收标准。`,
    },
  ],

  /**
   * Plan Reject: 计划驳回与无副作用退出
   * 验证：点击 Reject 后，计划变为 rejected，直接 done，期间无任何 write/shell
   */
  plan_reject: (task) => [
    {
      type: 'command',
      command: 'plan',
      accepted: true,
      note: 'Command accepted: Planning mode active.',
    },
    {
      type: 'goal',
      description: '全盘格式化与无用临时文件清理',
      acceptanceCriteria: [
        '清理 workspace 下所有未纳入 git 的临时脚本',
        '统一重命名目录',
      ],
    },
    {
      type: 'plan',
      status: 'proposed',
      steps: [
        '步骤 1: 扫描并批量删除根目录下所有 .tmp 与 .bak 历史文件',
        '步骤 2: 重新初始化 workspace 配置',
      ],
      risks: [
        '【高危风险】操作具有不可逆破坏性，可能误删未保存的代码草稿！',
      ],
    },
    {
      type: 'ask',
      id: 'ask_plan_rej_001',
      kind: 'plan_approval',
      question: '高危破坏性操作方案已提出。请审阅 Plan。若存在风险请点击 Reject 拒绝。',
    },
  ],

  /**
   * Plan Revise: 计划修改与重新规划
   * 验证：点击 Revise 并输入意见 -> 重新生成 revised 状态的 Plan，Goal 保持不变
   */
  plan_revise: (task) => [
    {
      type: 'command',
      command: 'plan',
      accepted: true,
      note: 'Command accepted: Initial planning.',
    },
    {
      type: 'goal',
      description: '构建核心数据加密验证模块',
      acceptanceCriteria: [
        '支持 SHA-256 哈希计算',
        '严格单元测试覆盖',
      ],
    },
    {
      type: 'plan',
      status: 'proposed',
      steps: [
        '步骤 1: 使用原生 JavaScript 快速拼接一个散列函数',
        '步骤 2: 打印输出测试',
      ],
      risks: [
        '未采用 TypeScript 强类型，缺少类型定义',
      ],
    },
    {
      type: 'ask',
      id: 'ask_plan_rev_001',
      kind: 'plan_approval',
      question: '初始方案提出。点击 Revise 可要求 Agent 改用严格 TypeScript 重写计划。',
    },
  ],

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 4/5/6: 运行时状态（完成校验 / 停滞早停 / 记忆沉淀）
  // ─────────────────────────────────────────────────────────────

  /**
   * Completion Gate: 完成标准未达标驳回与补做验证
   * 第一次 complete: false -> 补充执行 -> 第二次 complete: true -> done
   */
  completion_gate: (task) => [
    {
      type: 'message',
      role: 'assistant',
      content: `收到任务：创建 \`hello.py\` 并运行验证。开始第一步写入代码。`,
    },
    {
      type: 'tool_call',
      id: 'call_wf_cg_001',
      name: 'write_file',
      args: {
        path: 'hello.py',
        content: `print("Hello from Completion Gate verification!")\n`,
      },
    },
    {
      type: 'tool_result',
      id: 'call_wf_cg_001',
      name: 'write_file',
      ok: true,
      result: `Successfully wrote 49 bytes to hello.py`,
    },
    {
      type: 'completion_check',
      complete: false,
      attempt: 1,
      reason: '未满足验收条件：只创建了文件，尚未执行验证脚本',
      remaining: ['运行 python hello.py 验证实际输出'],
    },
    {
      type: 'message',
      role: 'assistant',
      content: `【Completion Gate 驳回】运行时拦截了未达标的结束意图：脚本尚未运行验证。立即补做验证步骤...`,
    },
    {
      type: 'tool_call',
      id: 'call_sh_cg_002',
      name: 'shell',
      args: { command: 'python hello.py' },
    },
    {
      type: 'tool_result',
      id: 'call_sh_cg_002',
      name: 'shell',
      ok: true,
      result: `Hello from Completion Gate verification!\n[Process exited with code 0]`,
    },
    {
      type: 'completion_check',
      complete: true,
      attempt: 2,
    },
    {
      type: 'done',
      text: `【验证通过】代码生成与实际运行验证全部完成并通过验收！`,
    },
  ],

  /**
   * Early Stop & Stall Warning: 停滞警告与早停熔断
   * 连续多次重复读取无变化文件 -> stall_warning -> 触发 early_stop(stalled)
   */
  early_stop_stall: (task) => [
    {
      type: 'message',
      role: 'assistant',
      content: `开始排查构建日志中的错误原因。`,
    },
    {
      type: 'tool_call',
      id: 'call_rf_st_001',
      name: 'read_file',
      args: { path: 'build.log' },
    },
    {
      type: 'tool_result',
      id: 'call_rf_st_001',
      name: 'read_file',
      ok: true,
      result: `[ERROR] Module '@internal/core' not found`,
    },
    {
      type: 'tool_call',
      id: 'call_rf_st_002',
      name: 'read_file',
      args: { path: 'build.log' },
    },
    {
      type: 'tool_result',
      id: 'call_rf_st_002',
      name: 'read_file',
      ok: true,
      result: `[ERROR] Module '@internal/core' not found`,
    },
    {
      type: 'tool_call',
      id: 'call_rf_st_003',
      name: 'read_file',
      args: { path: 'build.log' },
    },
    {
      type: 'tool_result',
      id: 'call_rf_st_003',
      name: 'read_file',
      ok: true,
      result: `[ERROR] Module '@internal/core' not found`,
    },
    {
      type: 'stall_warning',
      round: 3,
    },
    {
      type: 'message',
      role: 'assistant',
      content: `尝试重新读取相同文件...`,
    },
    {
      type: 'tool_call',
      id: 'call_rf_st_004',
      name: 'read_file',
      args: { path: 'build.log' },
    },
    {
      type: 'tool_result',
      id: 'call_rf_st_004',
      name: 'read_file',
      ok: true,
      result: `[ERROR] Module '@internal/core' not found`,
    },
    {
      type: 'early_stop',
      stopReason: 'stalled',
      detail: '检测到连续 4 轮重复读取同一未变化文件且无状态推进，触发停滞熔断早停机制，避免空耗 Token 与死循环。',
    },
  ],

  /**
   * Memory Consolidate: 会话轻量记忆沉淀
   * 完成任务后沉淀有效偏好到长期 Soul
   */
  memory_consolidate: (task) => [
    {
      type: 'message',
      role: 'assistant',
      content: `分析并优化项目代码，记录长期重构偏好。`,
    },
    {
      type: 'tool_call',
      id: 'call_rf_mem_001',
      name: 'read_file',
      args: { path: 'src/index.ts' },
    },
    {
      type: 'tool_result',
      id: 'call_rf_mem_001',
      name: 'read_file',
      ok: true,
      result: `export * from './core/context.js';\n`,
    },
    {
      type: 'done',
      text: `【任务完成】代码结构核对完毕。`,
    },
    {
      type: 'soul',
      action: 'consolidated',
      summary: 'Added preference: Always prefer ESM import syntax; avoid deep relative path nesting.',
    },
  ],
};
