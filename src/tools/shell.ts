import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool } from "../agent/types.js";
import type { Context } from "../core/context.js";
import { describeError } from "./read-file.js";

const execAsync = promisify(exec);

const SHELL_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;

export const shellSchema = z.object({
  command: z.string().min(1).describe("Shell command to run in the workspace directory"),
});

/**
 * 解码子进程输出：先用严格 UTF-8 探测，失败则回退 GBK
 * （中文 Windows 的 cmd/OEM 代码页输出），再失败按 latin1 兜底。
 */
function decodeOutput(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    /* 不是合法 UTF-8，继续尝试 */
  }
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return buffer.toString("latin1");
  }
}

export const shellTool: Tool = {
  name: "shell",
  description:
    "Execute a shell command in the workspace directory. Returns exit code, stdout and stderr. Times out after 60 seconds.",
  schema: shellSchema,
  risk: "dangerous",
  parallelSafe: false,
  async execute(args: unknown, ctx: Context) {
    const parsed = shellSchema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, output: `Invalid arguments: ${parsed.error.message}` };
    }
    try {
      const { stdout, stderr } = await execAsync(parsed.data.command, {
        cwd: ctx.workspace,
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        encoding: "buffer",
      });
      return {
        ok: true,
        output: formatShellResult(0, decodeOutput(stdout), decodeOutput(stderr)),
      };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; code?: unknown };
      // 非零退出码也属于正常执行结果，回灌模型让其自我纠正
      if (typeof e.code !== "undefined" && (e.stdout !== undefined || e.stderr !== undefined)) {
        const exitCode = typeof e.code === "number" ? e.code : 1;
        return {
          ok: exitCode === 0,
          output: formatShellResult(
            exitCode,
            decodeOutput(e.stdout ?? Buffer.alloc(0)),
            decodeOutput(e.stderr ?? Buffer.alloc(0)),
          ),
        };
      }
      return { ok: false, output: `shell failed: ${describeError(err)}` };
    }
  },
};

function formatShellResult(exitCode: number, stdout: string, stderr: string): string {
  const clip = (s: string) =>
    s.length > MAX_OUTPUT_CHARS
      ? s.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncated ${s.length - MAX_OUTPUT_CHARS} chars]`
      : s;
  return `exit: ${exitCode}\n--- stdout ---\n${clip(stdout) || "(empty)"}\n--- stderr ---\n${clip(stderr) || "(empty)"}`;
}
