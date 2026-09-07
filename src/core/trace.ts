import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * 最小 Trace 记录器：把 Agent 事件（含每步完整 LLM 请求/响应）
 * 以 JSON Lines 追加写入文件，供运行后审计回放。
 * 只旁路记录，不参与 Agent Loop 执行；写失败不影响运行（仅 stderr 提示）。
 */
export class TraceRecorder {
  private readonly filePath: string;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** 在 traces/ 目录下按启动时间创建一个 .jsonl 文件 */
  static async create(rootDir: string): Promise<TraceRecorder> {
    const dir = path.join(rootDir, "traces");
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new TraceRecorder(path.join(dir, `run-${stamp}.jsonl`));
  }

  get file(): string {
    return this.filePath;
  }

  async record(entry: Record<string, unknown>): Promise<void> {
    try {
      await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      console.error(`[trace] failed to write: ${err instanceof Error ? err.message : err}`);
    }
  }
}
