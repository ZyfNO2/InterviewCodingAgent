import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import type { Tool } from "../agent/types.js";
import type { Context } from "../core/context.js";
import { describeError, resolveInWorkspace } from "./read-file.js";

export const writeFileSchema = z.object({
  path: z.string().min(1).describe("Relative path inside the workspace"),
  content: z.string().describe("Full text content to write"),
});

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Write (or overwrite) a text file inside the workspace, creating parent directories automatically.",
  schema: writeFileSchema,
  async execute(args: unknown, ctx: Context) {
    const parsed = writeFileSchema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, output: `Invalid arguments: ${parsed.error.message}` };
    }
    const abs = resolveInWorkspace(ctx.workspace, parsed.data.path);
    if (!abs) {
      return { ok: false, output: "path escapes workspace" };
    }
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, parsed.data.content, "utf-8");
      return {
        ok: true,
        output: `Wrote ${parsed.data.content.length} chars to ${parsed.data.path}`,
      };
    } catch (err) {
      return { ok: false, output: `write_file failed: ${describeError(err)}` };
    }
  },
};
