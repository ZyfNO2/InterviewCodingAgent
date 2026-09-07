import * as fs from "node:fs/promises";
import * as path from "node:path";

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
 * /init 命令语义（B.4）：
 * - /init            → Soul 不存在则用模板创建；已存在则提示，不覆盖
 * - /init <content>  → content 作为初始 User Preference 写入
 *   （文件已存在时追加到 ## User Preferences 段，不覆盖既有内容）
 * 返回给用户/前端的确认文本。
 */
export async function initSoul(memory: MemoryService, initialPreference?: string): Promise<string> {
  const existing = await memory.loadSoul();
  const pref = (initialPreference ?? "").trim();

  if (!existing) {
    const content = pref
      ? SOUL_TEMPLATE.replace("## User Preferences\n", `## User Preferences\n- ${pref}\n`)
      : SOUL_TEMPLATE;
    await memory.saveSoul(content);
    return pref
      ? `SOUL.md created with initial preference: "${pref}".`
      : "SOUL.md created from template.";
  }

  if (!pref) {
    return "SOUL.md already exists; left unchanged.";
  }

  // 已存在：把偏好追加进 ## User Preferences 段（不覆盖既有内容）
  const marker = "## User Preferences";
  let updated: string;
  if (existing.includes(marker)) {
    updated = existing.replace(marker, `${marker}\n- ${pref}`);
  } else {
    updated = `${existing.trimEnd()}\n\n${marker}\n- ${pref}\n`;
  }
  await memory.saveSoul(updated);
  return `Preference added to SOUL.md: "${pref}".`;
}
