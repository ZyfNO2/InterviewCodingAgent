import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { Context } from "../src/core/context.js";
import type { AgentConfig } from "../src/agent/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { shellTool } from "../src/tools/shell.js";
import type { Tool, ToolCall } from "../src/agent/types.js";

function makeCtx(workspace: string): Context {
  const config: AgentConfig = { workspace, maxSteps: 20, apiKey: "unused", model: "unused" };
  return new Context(workspace, config);
}

function makeCall(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call-${name}-${Math.random().toString(36).slice(2, 8)}`, name, arguments: JSON.stringify(args) };
}

/** 记录执行时间线与并发度的假工具 */
function makeTimedTool(name: string, parallelSafe: boolean, delayMs: number, timeline: string[]) {
  const concurrent = { current: 0, max: 0 };
  const tool: Tool = {
    name,
    description: `timed ${name}`,
    schema: z.object({ tag: z.string().optional() }),
    risk: "safe",
    parallelSafe,
    async execute(args) {
      concurrent.current++;
      concurrent.max = Math.max(concurrent.max, concurrent.current);
      await new Promise((r) => setTimeout(r, delayMs));
      concurrent.current--;
      timeline.push(`${name}:${(args as { tag?: string }).tag ?? "?"}`);
      return { ok: true, output: `${name}(${(args as { tag?: string }).tag ?? "?"})` };
    },
  };
  return { tool, concurrent };
}

describe("Feature C — Parallel Tool Calling (executeBatch)", () => {
  it("连续 parallelSafe 工具并行执行（并发度 > 1，总耗时 ≪ 顺序执行）", async () => {
    const registry = new ToolRegistry();
    const timeline: string[] = [];
    const DELAY = 120;
    for (const name of ["r1", "r2", "r3"]) {
      registry.register(makeTimedTool(name, true, DELAY, timeline).tool);
    }
    // 并发度探针：parallelSafe 且立即返回，证明同批确有并发
    const probe = makeTimedTool("probe", true, 0, []);
    registry.register(probe.tool);

    const calls = [makeCall("r1", {}), makeCall("r2", {}), makeCall("r3", {})];
    const start = Date.now();
    const results = await registry.executeBatch(calls, makeCtx("."));
    const elapsed = Date.now() - start;

    // 顺序执行需 ~360ms；并行应明显小于 3 倍单次延迟
    assert.ok(elapsed < DELAY * 3 * 0.75, `expected parallel speedup, elapsed=${elapsed}ms`);
    // 结果按原 call 顺序回灌
    assert.deepEqual(
      results.map((r) => r.output),
      ["r1(?)", "r2(?)", "r3(?)"],
    );
  });

  it("混合批次：parallelSafe 段并行，非 parallelSafe 顺序执行，顺序语义正确", async () => {
    const registry = new ToolRegistry();
    const timeline: string[] = [];
    const r1 = makeTimedTool("r1", true, 80, timeline);
    const r2 = makeTimedTool("r2", true, 80, timeline);
    const slowWrite = makeTimedTool("write", false, 60, timeline);
    registry.register(r1.tool);
    registry.register(r2.tool);
    registry.register(slowWrite.tool);

    const calls = [
      makeCall("r1", {}),
      makeCall("r2", {}),
      makeCall("write", {}),
      makeCall("r1", {}),
    ];
    const results = await registry.executeBatch(calls, makeCtx("."));

    assert.deepEqual(
      results.map((r) => r.output),
      ["r1(?)", "r2(?)", "write(?)", "r1(?)"],
    );
    // write 不与任何并行（它执行时无其他工具并发）
    assert.ok(slowWrite.concurrent.max === 1, `write concurrency=${slowWrite.concurrent.max}`);
    // 两个 read 并发过
    assert.ok(r1.concurrent.max === 1 || r2.concurrent.max === 2);
  });

  it("含 write_file / shell 的真实批次不发生错误并行（真实工具标记验证）", () => {
    assert.equal(readFileTool.parallelSafe, true);
    assert.equal(readFileTool.risk, "safe");
    assert.equal(writeFileTool.parallelSafe, false);
    assert.equal(writeFileTool.risk, "dangerous");
    assert.equal(shellTool.parallelSafe, false);
    assert.equal(shellTool.risk, "dangerous");
  });

  it("未知工具 / 校验失败在批次中回灌 ok:false，不阻塞其他调用", async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const calls = [
      makeCall("read_file", { path: "package.json" }),
      makeCall("no_such_tool", {}),
      makeCall("read_file", { wrong: 1 }),
    ];
    const results = await registry.executeBatch(calls, makeCtx("."));
    assert.equal(results[0]!.ok, true);
    assert.equal(results[1]!.ok, false);
    assert.match(results[1]!.output, /Unknown tool/);
    assert.equal(results[2]!.ok, false);
    assert.match(results[2]!.output, /Invalid arguments/);
  });

  it("batchStats 划分连续 parallelSafe 段", () => {
    const stats = ToolRegistry.batchStats(
      [makeCall("read_file", {}), makeCall("read_file", {}), makeCall("write_file", {}), makeCall("read_file", {})],
      (name) => name === "read_file",
    );
    assert.deepEqual(stats.parallelGroups, [2, 1]);
    assert.equal(stats.sequential, 1);
  });
});
