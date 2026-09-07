import { z } from "zod";
import type { Tool } from "../agent/types.js";
import type { Context } from "../core/context.js";

export const askUserSchema = z.object({
  question: z.string().min(1).describe("The question to ask the human user"),
});

/**
 * Feature B — ask_user：
 * LLM → ask_user → Agent 暂停 → CLI 输入 → ToolResult 回灌 → Agent 恢复。
 * 证明 Loop 支持 LLM → Environment → Human → Agent，而非仅 LLM → Tool。
 *
 * prompt 函数由 cli 层构造时注入（与 Permission 复用同一个 readline 封装）。
 */
export function createAskUserTool(prompt: (question: string) => Promise<string>): Tool {
  return {
    name: "ask_user",
    description:
      "Ask the human user a question and wait for their typed answer. " +
      "Use it when the task is ambiguous or missing information you need. " +
      "Returns the user's answer as text.",
    schema: askUserSchema,
    risk: "safe", // 问问题不危险
    parallelSafe: false, // 需要独占终端交互
    async execute(args: unknown, _ctx: Context) {
      const parsed = askUserSchema.safeParse(args);
      if (!parsed.success) {
        return { ok: false, output: `Invalid arguments: ${parsed.error.message}` };
      }
      try {
        const answer = await prompt(`\n🤖 Agent asks: ${parsed.data.question}\n> `);
        return { ok: true, output: `User's answer: ${answer}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `ask_user failed: ${message}` };
      }
    },
  };
}
