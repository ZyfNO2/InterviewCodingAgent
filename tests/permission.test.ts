import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { Context } from "../src/core/context.js";
import {
  AllowAllPermissionService,
  CliPermissionService,
  type PermissionService,
} from "../src/core/permission.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { shellTool } from "../src/tools/shell.js";
import type { AgentConfig, Tool } from "../src/agent/types.js";

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-perm-test-"));

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function makeCtx(): Context {
  const config: AgentConfig = {
    workspace: tmpRoot,
    maxSteps: 20,
    apiKey: "unused",
    model: "unused",
  };
  return new Context(tmpRoot, config);
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(shellTool);
  return registry;
}

const DENIED = { id: "d", name: "shell", arguments: '{"command":"echo should-not-run"}' };

describe("Feature A — Tool Permission Control", () => {
  it("危险工具无 permission 服务时 fail-closed 拒绝", async () => {
    const ctx = makeCtx(); // 不注入 permission
    const result = await makeRegistry().execute(DENIED, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.output, "denied by user");
  });

  it("Permission 拒绝 → 返回 denied，工具未执行", async () => {
    const ctx = makeCtx();
    let executed = false;
    const spy: Tool = {
      name: "shell",
      description: "spy",
      schema: z.object({}),
      risk: "dangerous",
      parallelSafe: false,
      async execute() {
        executed = true;
        return { ok: true, output: "ran" };
      },
    };
    const registry = new ToolRegistry();
    registry.register(spy);
    ctx.provide("permission", {
      check: async () => false,
    } satisfies PermissionService);

    const result = await registry.execute({ id: "1", name: "shell", arguments: "{}" }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.output, "denied by user");
    assert.equal(executed, false); // 命令确实没有执行
  });

  it("Permission 批准 → 正常执行", async () => {
    const ctx = makeCtx();
    ctx.provide("permission", new AllowAllPermissionService());
    const result = await makeRegistry().execute(
      { id: "2", name: "shell", arguments: '{"command":"echo approved-run"}' },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.match(result.output, /approved-run/);
  });

  it("safe 工具（read_file）不触发 permission 检查", async () => {
    await fs.writeFile(path.join(tmpRoot, "safe.txt"), "content", "utf-8");
    const ctx = makeCtx();
    let checks = 0;
    ctx.provide("permission", {
      check: async () => {
        checks++;
        return false;
      },
    } satisfies PermissionService);

    const result = await makeRegistry().execute(
      { id: "3", name: "read_file", arguments: '{"path":"safe.txt"}' },
      ctx,
    );
    assert.equal(result.ok, true); // 虽然 permission 全拒，但 safe 工具不经过检查
    assert.equal(checks, 0);
  });

  it("CliPermissionService：y/yes 批准，其他一律拒绝", async () => {
    const answers = ["y", "yes", "n", "", "no", "Y", "YES"];
    for (const answer of answers) {
      const service = new CliPermissionService(async () => answer);
      const allowed = await service.check(shellTool, { command: "x" }, makeCtx());
      const expected = ["y", "yes", "Y", "YES"].includes(answer);
      assert.equal(allowed, expected, `answer="${answer}"`);
    }
  });

  it("CliPermissionService：EOF/读取失败视为拒绝（fail-closed）", async () => {
    const service = new CliPermissionService(async () => {
      throw new Error("stdin closed");
    });
    const allowed = await service.check(shellTool, { command: "x" }, makeCtx());
    assert.equal(allowed, false);
  });

  it("AllowAllPermissionService 全放行", async () => {
    const service = new AllowAllPermissionService();
    assert.equal(await service.check(shellTool, {}, makeCtx()), true);
  });
});
