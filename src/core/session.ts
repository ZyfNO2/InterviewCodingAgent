import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../agent/types.js";

/**
 * AgentSession（doc 09 Phase4·Step1）：
 * 把「一次 run()」与「一个 Session」分离——连续任务共享历史，不同 Session 相互隔离。
 * goal/plan/progress 为后续 Step 的占位结构，本步只建结构与初始化，不实现行为。
 */

/** Step 3 占位：会话目标（本步不实现行为） */
export interface AgentGoal {
  // 占位
}

/** Step 3 占位：会话计划（本步不实现行为） */
export interface AgentPlan {
  // 占位
}

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

export interface AgentSession {
  id: string;
  /** 会话历史；system prompt 只在建 session 时入一次 */
  messages: ChatMessage[];
  /** 用户回合数（≠ agent steps）：每次 run(session, task) +1 */
  userTurns: number;
  goal?: AgentGoal;
  plan?: AgentPlan;
  progress: {
    seenResults: Set<string>;
    stallRounds: number;
    completionChecks: number;
  };
}

/** Session 工厂：system prompt 在此入一次；id 缺省自动生成 */
export function createSession(id?: string): AgentSession {
  return {
    id: id ?? randomUUID(),
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    userTurns: 0,
    progress: { seenResults: new Set(), stallRounds: 0, completionChecks: 0 },
  };
}
