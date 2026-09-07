import type { AgentGoal, AgentPlan } from "../core/session.js";

/**
 * Prompt Assembly（doc 10 Phase4·Step2 B.3）：
 * 集中式 System Prompt 组装。Agent Loop 只调用 buildSystemPrompt，不碰 Markdown。
 *
 * 稳定前缀顺序（A.2 硬约定）：
 *   1. SYSTEM_PROMPT
 *   2. SOUL.md（# Persistent Memory）
 *   3. Stable Project Instructions（当前包含在 SYSTEM_PROMPT 内）
 *   4. Goal（空则省略）
 *   5. Plan（空则省略）
 * Stable Prefix 内不混入时间、随机 runtime 信息、动态 trace、当前 step，
 * 以保持 Prompt / KV Cache 前缀稳定。
 */

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

export interface PromptParts {
  /** SOUL.md 全文（长期稳定文本；空串表示未启用） */
  soul?: string;
  /** 当前目标（空/undefined 则省略段落） */
  goal?: AgentGoal | string;
  /** 当前计划（空/undefined 则省略段落） */
  plan?: AgentPlan | string;
}

/** 把 goal/plan 占位对象/字符串规整为可注入文本；空返回 "" */
function sectionText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  // 占位对象（Step 3 前的 AgentGoal/AgentPlan）无文本表示
  return "";
}

/**
 * 组装 System Prompt。空段落整体省略，不产生空标题噪声。
 * 输出只依赖输入内容本身——同一 soul/goal/plan 永远得到同一字符串。
 */
export function buildSystemPrompt(parts: PromptParts): string {
  const sections: string[] = [SYSTEM_PROMPT];

  const soul = (parts.soul ?? "").trim();
  if (soul) {
    sections.push(`# Persistent Memory\n${soul}`);
  }

  const goal = sectionText(parts.goal);
  if (goal) {
    sections.push(`# Current Goal\n${goal}`);
  }

  const plan = sectionText(parts.plan);
  if (plan) {
    sections.push(`# Current Plan\n${plan}`);
  }

  return sections.join("\n\n");
}
