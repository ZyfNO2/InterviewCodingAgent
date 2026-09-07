import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool, ToolCall, ToolResult } from "../agent/types.js";
import type { Context } from "../core/context.js";
import type { PermissionService } from "../core/permission.js";
import { describeError } from "./read-file.js";

/**
 * Tool 能力注册与 Schema 导出。
 * Permission（阶段二）与 Parallel（阶段二）都挂在此处，Agent Loop 核心不变。
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
   * JSON.parse → zod 校验 → permission 检查 → tool.execute；
   * 任何一步失败都返回 ok:false，不抛出。
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

    // Feature A：危险工具执行前必须获得人类批准。
    // 未注册 permission 服务时 fail-closed（拒绝执行危险工具）。
    if (tool.risk === "dangerous") {
      const allowed = ctx.has("permission")
        ? await ctx.resolve<PermissionService>("permission").check(tool, parsed.data, ctx)
        : false;
      if (!allowed) {
        return { ok: false, output: "denied by user" };
      }
    }

    try {
      return await tool.execute(parsed.data, ctx);
    } catch (err) {
      return { ok: false, output: `Tool "${call.name}" crashed: ${describeError(err)}` };
    }
  }

  /**
   * Feature C — 执行一批 tool calls：
   * 连续的 parallelSafe 工具分组 Promise.all 并行，其余逐个 await；
   * 结果严格按原 call 顺序返回。不做复杂 Scheduler。
   * Permission 检查在 execute 内逐个进行（危险工具本就非 parallelSafe）。
   */
  async executeBatch(calls: ToolCall[], ctx: Context): Promise<ToolResult[]> {
    const results: ToolResult[] = new Array(calls.length);
    let i = 0;
    while (i < calls.length) {
      if (this.isParallelSafe(calls[i]!)) {
        // 收集连续的 parallelSafe 段
        let j = i + 1;
        while (j < calls.length && this.isParallelSafe(calls[j]!)) {
          j++;
        }
        const groupResults = await Promise.all(
          calls.slice(i, j).map((call) => this.execute(call, ctx)),
        );
        for (let k = 0; k < groupResults.length; k++) {
          results[i + k] = groupResults[k]!;
        }
        i = j;
      } else {
        results[i] = await this.execute(calls[i]!, ctx);
        i++;
      }
    }
    return results;
  }

  private isParallelSafe(call: ToolCall): boolean {
    return this.tools.get(call.name)?.parallelSafe === true;
  }

  /** 并行统计信息（供事件渲染展示"并行发起"） */
  static batchStats(calls: ToolCall[], isParallelSafe: (name: string) => boolean): {
    parallelGroups: number[];
    sequential: number;
  } {
    const parallelGroups: number[] = [];
    let sequential = 0;
    let i = 0;
    while (i < calls.length) {
      if (isParallelSafe(calls[i]!.name)) {
        let j = i + 1;
        while (j < calls.length && isParallelSafe(calls[j]!.name)) {
          j++;
        }
        parallelGroups.push(j - i);
        i = j;
      } else {
        sequential++;
        i++;
      }
    }
    return { parallelGroups, sequential };
  }
}
