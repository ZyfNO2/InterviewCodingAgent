// 工具执行结果
export interface ToolResult {
  ok: boolean;
  /** 成功输出或错误说明，都以文本回灌模型 */
  output: string;
}

// 工具统一接口
export interface Tool {
  name: string;
  description: string;
  schema: ZodTypeAny; // 入参 schema（zod）
  execute(args: unknown, ctx: Context): Promise<ToolResult>;
}

// LLM 响应两态
export type LLMResponse =
  | { type: "final"; text: string }
  | { type: "tool_calls"; calls: ToolCall[] };

export interface ToolCall {
  /** tool_call_id，回灌时必须原样带回 */
  id: string;
  name: string;
  /** 模型给的 JSON 字符串，执行前 parse + zod 校验 */
  arguments: string;
}

/** 回灌历史时 assistant.tool_calls 的序列化格式（OpenAI 规范要求 type 字段） */
export type SerializedToolCall = ToolCall & { type: "function" };

export function serializeToolCall(call: ToolCall): SerializedToolCall {
  return { type: "function", id: call.id, name: call.name, arguments: call.arguments };
}

// 消息（OpenAI function calling 格式）
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: SerializedToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentConfig {
  workspace: string;
  maxSteps: number;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

import type { ZodTypeAny } from "zod";
import type { Context } from "../core/context.js";
