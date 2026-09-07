import * as path from "node:path";
import { z } from "zod";
import type { Tool } from "../agent/types.js";
import type { Context } from "../core/context.js";

export const readFileSchema = z.object({
  path: z.string().min(1).describe("Relative path inside the workspace"),
});

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read the text content of a file inside the workspace. Returns the file content, or an error if the file does not exist or the path escapes the workspace.",
  schema: readFileSchema,
  async execute(args: unknown, ctx: Context) {
    const parsed = readFileSchema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, output: `Invalid arguments: ${parsed.error.message}` };
    }
    const abs = resolveInWorkspace(ctx.workspace, parsed.data.path);
    if (!abs) {
      return { ok: false, output: "path escapes workspace" };
    }
    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(abs, "utf-8");
      return { ok: true, output: content };
    } catch (err) {
      return { ok: false, output: `read_file failed: ${describeError(err)}` };
    }
  },
};

/** Resolve a workspace-relative path; returns null if it escapes the workspace. */
export function resolveInWorkspace(workspace: string, relPath: string): string | null {
  const workspaceRoot = path.resolve(workspace);
  const abs = path.resolve(workspaceRoot, relPath);
  if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + path.sep)) {
    return null;
  }
  return abs;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${err.message} (code=${code})` : err.message;
  }
  return String(err);
}
