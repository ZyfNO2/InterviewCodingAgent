import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Context } from "../src/core/context.js";
import type { AgentConfig } from "../src/agent/types.js";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { shellTool } from "../src/tools/shell.js";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-tools-test-"));

function makeCtx(workspace: string): Context {
  const config: AgentConfig = {
    workspace,
    maxSteps: 20,
    apiKey: "unused",
    model: "unused",
  };
  return new Context(workspace, config);
}

const ctx = makeCtx(tmpDir);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("read_file / write_file", () => {
  it("write → read 往返一致", async () => {
    const write = await writeFileTool.execute(
      { path: "a/b/hello.txt", content: "Hello Coding Agent" },
      ctx,
    );
    assert.equal(write.ok, true);

    const read = await readFileTool.execute({ path: "a/b/hello.txt" }, ctx);
    assert.equal(read.ok, true);
    assert.equal(read.output, "Hello Coding Agent");
  });

  it("write 自动建父目录", async () => {
    const stat = await fs.stat(path.join(tmpDir, "a/b"));
    assert.ok(stat.isDirectory());
  });

  it("read 不存在的文件返回 ok:false", async () => {
    const read = await readFileTool.execute({ path: "ghost.txt" }, ctx);
    assert.equal(read.ok, false);
    assert.match(read.output, /ENOENT/);
  });

  it("读路径越权被拒（../ 逃逸）", async () => {
    const read = await readFileTool.execute({ path: "../../package.json" }, ctx);
    assert.equal(read.ok, false);
    assert.match(read.output, /escapes workspace/);
  });

  it("写路径越权被拒", async () => {
    const write = await writeFileTool.execute(
      { path: "../escape.txt", content: "x" },
      ctx,
    );
    assert.equal(write.ok, false);
    assert.match(write.output, /escapes workspace/);
    // 确认确实没有写到 workspace 外
    await assert.rejects(fs.access(path.join(tmpDir, "../escape.txt")));
  });

  it("绝对路径指向 workspace 外被拒", async () => {
    const read = await readFileTool.execute(
      { path: path.join(os.tmpdir(), "definitely-outside.txt") },
      ctx,
    );
    assert.equal(read.ok, false);
    assert.match(read.output, /escapes workspace/);
  });

  it("入参不符合 zod schema 返回 ok:false", async () => {
    const read = await readFileTool.execute({ wrong: "field" }, ctx);
    assert.equal(read.ok, false);
  });
});

describe("shell", () => {
  it("捕获 stdout 与退出码 0，输出为结构化文本", async () => {
    const result = await shellTool.execute({ command: "echo hello-shell" }, ctx);
    assert.equal(result.ok, true);
    assert.match(result.output, /^exit: 0\n--- stdout ---\n/);
    assert.match(result.output, /hello-shell/);
  });

  it("捕获非零退出码且不抛出", async () => {
    const result = await shellTool.execute(
      { command: 'node -e "process.exit(3)"' },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /^exit: 3\n/);
  });

  it("stderr 被捕获", async () => {
    const result = await shellTool.execute(
      { command: 'node -e "console.error(\\"boom-stderr\\")"' },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.match(result.output, /--- stderr ---\nboom-stderr/);
  });

  it("cwd 是 workspace", async () => {
    const result = await shellTool.execute(
      { command: 'node -e "console.log(process.cwd())"' },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.ok(result.output.includes(path.resolve(tmpDir)));
  });

  it("入参不符合 schema 返回 ok:false", async () => {
    const result = await shellTool.execute({}, ctx);
    assert.equal(result.ok, false);
  });
});
