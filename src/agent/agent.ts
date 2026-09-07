import type { AgentConfig, ChatMessage, LLMResponse, ToolCall } from "./types.js";
import { serializeToolCall } from "./types.js";
import type { Context } from "../core/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { resolveToolResultCharLimit, truncateToolResultOutput } from "../core/context-manager.js";
import type { LLMProvider } from "../llm/provider.js";

export const SYSTEM_PROMPT = `You are a coding agent working inside a sandboxed workspace directory.
You can use these tools:
- read_file({ path }): read a text file inside the workspace
- write_file({ path, content }): write or overwrite a text file inside the workspace (parent dirs auto-created)
- shell({ command }): run a shell command with the workspace as cwd
- ask_user({ question }): ask the human user a question and wait for their typed answer

Rules:
- All file paths are relative to the workspace root. Paths escaping the workspace are rejected.
- Dangerous tools (write_file, shell) require human approval before running; if denied, do not retry the same action.
- Tool errors are returned to you as text. Read them, fix the problem, and retry differently.
- When the task is complete, reply with a concise natural-language answer (no tool calls).`;

export interface AgentResult {
  finalText: string;
  stepsUsed: number;
}

/**
 * Agent Loop：模型调用 + 状态推进。错误一律回灌模型而非中断。
 */
export class Agent {
  constructor(
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly ctx: Context,
    private readonly config: AgentConfig,
    private readonly onEvent?: (event: AgentEvent) => void,
  ) {}

  async run(task: string): Promise<AgentResult> {
    this.onEvent?.({ type: "run_start", task, workspace: this.ctx.workspace });
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: task },
    ];

    for (let step = 1; step <= this.config.maxSteps; step++) {
      const res = await this.llm.chat(messages, this.tools.toLLMSchema());
      this.onEvent?.({ type: "llm_call", step, request: messages, response: res });

      if (res.type === "final") {
        this.onEvent?.({ type: "final", step, text: res.text });
        return { finalText: res.text, stepsUsed: step };
      }

      // 先把 assistant 的 tool_calls 消息入历史（带 type:"function"，OpenAI 规范要求）
      messages.push({ role: "assistant", content: null, tool_calls: res.calls.map(serializeToolCall) });

      // 批量执行：连续 parallelSafe 工具并行，其余顺序（Feature C，逻辑在 Registry）
      const stats = ToolRegistry.batchStats(res.calls, (name) => this.tools.get(name)?.parallelSafe === true);
      if (stats.parallelGroups.some((size) => size > 1) || res.calls.length > 1) {
        this.onEvent?.({ type: "batch", step, calls: res.calls, stats });
      }
      for (const call of res.calls) {
        this.onEvent?.({ type: "tool_call", step, call });
      }

      const results = await this.tools.executeBatch(res.calls, this.ctx);
      // Tool Result 截断（doc 07 二）：完整版照旧经 tool_result 事件进 Trace，截断版入 Context
      const charLimit = resolveToolResultCharLimit(this.config);
      for (let i = 0; i < res.calls.length; i++) {
        const call = res.calls[i]!;
        const result = results[i]!;
        this.onEvent?.({ type: "tool_result", step, call, result });
        const { contextText } = truncateToolResultOutput(result.output, charLimit);
        // 只变换 content 字符串，不增删消息，tool_call/tool_result 配对始终完整
        messages.push({ role: "tool", tool_call_id: call.id, content: contextText });
      }
    }

    const text = `Reached maxSteps (${this.config.maxSteps}) without a final answer.`;
    this.onEvent?.({ type: "max_steps_reached", maxSteps: this.config.maxSteps });
    return { finalText: text, stepsUsed: this.config.maxSteps };
  }
}

export type AgentEvent =
  | { type: "run_start"; task: string; workspace: string }
  | { type: "llm_call"; step: number; request: ChatMessage[]; response: LLMResponse }
  | { type: "tool_call"; step: number; call: ToolCall }
  | { type: "tool_result"; step: number; call: ToolCall; result: { ok: boolean; output: string } }
  | { type: "batch"; step: number; calls: ToolCall[]; stats: { parallelGroups: number[]; sequential: number } }
  | { type: "final"; step: number; text: string }
  | { type: "max_steps_reached"; maxSteps: number };
