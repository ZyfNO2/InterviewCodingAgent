import type { AgentConfig, ChatMessage, ToolCall } from "./types.js";
import { serializeToolCall } from "./types.js";
import type { Context } from "../core/context.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LLMProvider } from "../llm/provider.js";

export const SYSTEM_PROMPT = `You are a coding agent working inside a sandboxed workspace directory.
You can use these tools:
- read_file({ path }): read a text file inside the workspace
- write_file({ path, content }): write or overwrite a text file inside the workspace (parent dirs auto-created)
- shell({ command }): run a shell command with the workspace as cwd

Rules:
- All file paths are relative to the workspace root. Paths escaping the workspace are rejected.
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
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: task },
    ];

    for (let step = 1; step <= this.config.maxSteps; step++) {
      const res = await this.llm.chat(messages, this.tools.toLLMSchema());

      if (res.type === "final") {
        this.onEvent?.({ type: "final", step, text: res.text });
        return { finalText: res.text, stepsUsed: step };
      }

      // 先把 assistant 的 tool_calls 消息入历史（带 type:"function"，OpenAI 规范要求）
      messages.push({ role: "assistant", content: null, tool_calls: res.calls.map(serializeToolCall) });

      for (const call of res.calls) {
        this.onEvent?.({ type: "tool_call", step, call });
        const result = await this.tools.execute(call, this.ctx);
        this.onEvent?.({ type: "tool_result", step, call, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: result.output });
      }
    }

    const text = `Reached maxSteps (${this.config.maxSteps}) without a final answer.`;
    this.onEvent?.({ type: "max_steps_reached", maxSteps: this.config.maxSteps });
    return { finalText: text, stepsUsed: this.config.maxSteps };
  }
}

export type AgentEvent =
  | { type: "tool_call"; step: number; call: ToolCall }
  | { type: "tool_result"; step: number; call: ToolCall; result: { ok: boolean; output: string } }
  | { type: "final"; step: number; text: string }
  | { type: "max_steps_reached"; maxSteps: number };
