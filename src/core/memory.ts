import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LLMProvider } from "../llm/provider.js";
import type { ChatMessage } from "../agent/types.js";

/**
 * MemoryService（doc 10 Phase4·Step2 B.1）：
 * 长期稳定文本（Soul）的读写接口。Soul 全量注入稳定前缀，不做检索式召回；
 * consolidate 为 Step 6 占位。Agent Loop 不直接读写 Markdown，一律经此服务。
 */
export interface MemoryService {
  /** 读取 Soul 全文；不存在返回空串 */
  loadSoul(): Promise<string>;
  /** 保存 Soul 全文（目录不存在自动创建） */
  saveSoul(content: string): Promise<void>;
  /** Step 6 占位：会话结束后的记忆沉淀 */
  consolidate?(session: unknown): Promise<void>;
}

/** Soul 模板（B.2） */
export const SOUL_TEMPLATE = `# Soul

## Identity

## User Preferences

## Persistent Facts

## Working Conventions
`;

/**
 * MarkdownMemoryService：文件锚定 <workspace>/.agent/SOUL.md，
 * 避免污染项目根目录；目录不存在时自动创建。
 */
export class MarkdownMemoryService implements MemoryService {
  private readonly soulPath: string;

  constructor(workspace: string) {
    this.soulPath = path.join(path.resolve(workspace), ".agent", "SOUL.md");
  }

  get file(): string {
    return this.soulPath;
  }

  async loadSoul(): Promise<string> {
    try {
      return await fs.readFile(this.soulPath, "utf-8");
    } catch {
      return ""; // 不存在 → 空串
    }
  }

  async saveSoul(content: string): Promise<void> {
    await fs.mkdir(path.dirname(this.soulPath), { recursive: true });
    await fs.writeFile(this.soulPath, content, "utf-8");
  }
}

/**
 * Soul 策展提示词：让 LLM 对现有 SOUL.md 做增量合并 / 冲突改写，
 * 而不是机械追加。只允许长期稳定信息，禁止 Session/Trace 类瞬时内容。
 */
export const SOUL_CURATOR_PROMPT = `You are the curator of a coding agent's persistent memory file (SOUL.md).
The file stores ONLY long-term stable information:
- Agent Identity
- User Preferences (e.g. language/framework/style preferences)
- Persistent Facts (stable facts about the user's environment or projects)
- Working Conventions (e.g. "dangerous operations need confirmation")

It must NEVER contain transient/session data: current tasks, runtime state,
recent command outputs, timestamps, or step-by-step progress.

Your job: merge the user's new input into the existing SOUL.md.
- Add genuinely new information under the right section.
- If the input contradicts an existing entry, treat the user's new input as newer truth:
  rewrite/remove the stale entry (conflict resolution).
- Remove duplicates; reword minimally; keep entries short and stable.
- Keep the markdown structure: "# Soul" with sections "## Identity", "## User Preferences",
  "## Persistent Facts", "## Working Conventions" (create missing sections as needed).
- If the input is transient/small-talk with no long-term value, return the SOUL.md unchanged.

Output rules: output the COMPLETE new SOUL.md content only — no explanations, no code fences.`;

/**
 * 经 LLM 策展合并 Soul：现有内容 + 新输入 → 增量/冲突改写后的完整 SOUL.md。
 * 返回 null 表示 LLM 不可用或输出无效（调用方保持原文件不变）。
 */
async function mergeSoulViaLLM(
  llm: LLMProvider,
  existing: string,
  input: string,
): Promise<string | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: SOUL_CURATOR_PROMPT },
    {
      role: "user",
      content: `Current SOUL.md:\n---\n${existing || "(empty — start from the standard structure)"}\n---\n\nNew user input to merge:\n${input}`,
    },
  ];
  const res = await llm.chat(messages);
  if (res.type !== "final") return null;
  let text = res.text.trim();
  // 容错：剥掉模型可能带上的代码围栏
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenced) text = fenced[1]!.trim();
  return text || null;
}

/** 本地行级 diff 摘要（不改文件，仅用于确认信息） */
function diffSummary(oldText: string, newText: string): string {
  const oldLines = new Set(oldText.split("\n").map((l) => l.trim()).filter(Boolean));
  const newLines = new Set(newText.split("\n").map((l) => l.trim()).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const l of newLines) if (!oldLines.has(l)) added++;
  for (const l of oldLines) if (!newLines.has(l)) removed++;
  return `(+${added}/-${removed} lines)`;
}

/**
 * /init 命令语义（doc 10 B.4 + 用户修订）：
 * - /init                → Soul 不存在则用模板创建；已存在则提示，不覆盖
 * - /init <content>      → content 不得直接写入：先经 LLM 对现有 SOUL.md 做
 *   增量合并/冲突改写，产出完整新 SOUL.md 后保存。
 *   LLM 失败/输出无效 → 保持原文件不变并如实报告。
 * 返回给用户/前端的确认文本。
 */
export async function initSoul(memory: MemoryService, llm: LLMProvider, content?: string): Promise<string> {
  const existing = await memory.loadSoul();
  const input = (content ?? "").trim();

  if (!input) {
    if (!existing) {
      await memory.saveSoul(SOUL_TEMPLATE);
      return "SOUL.md created from template.";
    }
    return "SOUL.md already exists; left unchanged.";
  }

  // 有内容 → 必须经 LLM 策展（增量合并 / 冲突改写），禁止直接追加
  let merged: string | null = null;
  try {
    merged = await mergeSoulViaLLM(llm, existing, input);
  } catch (err) {
    console.error(`[memory] LLM merge failed: ${err instanceof Error ? err.message : err}`);
  }
  if (!merged) {
    return "Soul update failed (LLM unavailable or invalid output); SOUL.md left unchanged.";
  }

  await memory.saveSoul(merged);
  return existing
    ? `SOUL.md updated via LLM merge ${diffSummary(existing, merged)}.`
    : `SOUL.md created from your input via LLM curation ${diffSummary("", merged)}.`;
}
