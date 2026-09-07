/**
 * Mock 剧本库
 * 涵盖 Case 1（读取分析）、Case 2（写文件 + Shell + 权限审批 + ask_user 交互）
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
};
