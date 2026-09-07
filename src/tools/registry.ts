import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool, ToolCall, ToolResult } from "../agent/types.js";
import type { Context } from "../core/context.js";
import { describeError } from "./read-file.js";

/**
 * Tool 能力注册与 Schema 导出。
 * 阶段二的 permission / parallel 也挂在此处，不改 Agent Loop。
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** 导出 OpenAI tools 数组（zod → JSON Schema）。 */
  toLLMSchema() {
    return this.list().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema, { $refStrategy: "none" }),
      },
    }));
  }

  /**
   * 解析并执行一个 tool call。
   * JSON.parse → zod 校验 → tool.execute；任何一步失败都返回 ok:false，不抛出。
   */
  async execute(call: ToolCall, ctx: Context): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { ok: false, output: `Unknown tool: "${call.name}"` };
    }
    let args: unknown;
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch (err) {
      return { ok: false, output: `Invalid JSON arguments: ${describeError(err)}` };
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, output: `Invalid arguments: ${parsed.error.message}` };
    }
    try {
      return await tool.execute(parsed.data, ctx);
    } catch (err) {
      return { ok: false, output: `Tool "${call.name}" crashed: ${describeError(err)}` };
    }
  }
}
