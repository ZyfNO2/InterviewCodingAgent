import type { AgentConfig } from "../agent/types.js";

/**
 * ContextManager（doc 07 二）— 本切片仅实现「Tool Result 截断」：
 *
 *   完整结果 → Trace（Agent 的 tool_result 事件，index.ts 落 JSONL）
 *   截断结果 → LLM Context（tool message content）
 *
 * Trace 保存事实，Context 保存模型当前需要的信息。
 * 只变换 tool message 的 content 字符串，不增删消息 —— tool_call 与
 * tool_result 的配对关系永远完整（禁止裸 slice 切断历史）。
 */

/** 单个 tool result 进入 Context 的默认字符上限 */
export const DEFAULT_TOOL_RESULT_CHAR_LIMIT = 10_000;

export interface ToolResultTruncation {
  /** 是否发生了截断 */
  truncated: boolean;
  /** 进入 Context 的文本（未截断时等于原 output） */
  contextText: string;
}

/**
 * 截断超大 tool 结果：保留头尾（头 70% / 尾 30%），中间用标注替换，
 * 标注包含被丢弃的行数与字符数，并指向 trace 中的完整内容。
 *
 * limit <= 0 表示关闭截断（回退原始行为）；output 未超限时原样返回。
 */
export function truncateToolResultOutput(output: string, limit: number): ToolResultTruncation {
  if (limit <= 0 || output.length <= limit) {
    return { truncated: false, contextText: output };
  }

  const headLen = Math.floor(limit * 0.7);
  const tailLen = limit - headLen;
  const head = output.slice(0, headLen);
  const tail = output.slice(output.length - tailLen);
  const dropped = output.slice(headLen, output.length - tailLen);
  const droppedChars = dropped.length;
  const droppedLines = dropped.split("\n").length;

  const marker = `\n...[已截断 ${droppedLines} 行 / ${droppedChars} 字符，完整内容见 trace 文件 (truncated, full content in trace)]...\n`;
  return { truncated: true, contextText: head + marker + tail };
}

/**
 * 从 AgentConfig 取截断上限：显式 0 = 关闭；未配置 = 默认值。
 */
export function resolveToolResultCharLimit(config: AgentConfig): number {
  return config.toolResultCharLimit ?? DEFAULT_TOOL_RESULT_CHAR_LIMIT;
}
