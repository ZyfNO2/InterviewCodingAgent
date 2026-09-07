import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import { Context } from "../src/core/context.js";
import type { AgentConfig } from "../src/agent/types.js";

function makeCtx(workspace: string): Context {
  const config: AgentConfig = {
    workspace,
    maxSteps: 20,
    apiKey: "unused",
    model: "unused",
  };
  return new Context(workspace, config);
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  return registry;
}

const workspace = process.cwd() + "/examples/demo";
const ctx = makeCtx(workspace);

describe("ToolRegistry", () => {
  it("register 重名报错", () => {
    const registry = makeRegistry();
    assert.throws(() => registry.register(readFileTool), /already registered/);
  });

  it("get / list", () => {
    const registry = makeRegistry();
    assert.equal(registry.get("read_file")?.name, "read_file");
    assert.equal(registry.get("nope"), undefined);
    assert.deepEqual(
      registry.list().map((t) => t.name),
      ["read_file"],
    );
  });

  it("toLLMSchema 产出 OpenAI tools 数组结构", () => {
    const schema = makeRegistry().toLLMSchema();
    assert.equal(schema.length, 1);
    const entry = schema[0]!;
    assert.equal(entry.type, "function");
    assert.equal(entry.function.name, "read_file");
    assert.equal(typeof entry.function.description, "string");
    // zod → JSON Schema，无 $ref
    const params = entry.function.parameters as unknown as {
      type: string;
      properties: Record<string, unknown>;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties);
    assert.ok(JSON.stringify(params).includes("$ref") === false);
  });

  it("execute: 未知工具返回 ok:false 不抛出", async () => {
    const result = await makeRegistry().execute(
      { id: "1", name: "no_such_tool", arguments: "{}" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /Unknown tool/);
  });

  it("execute: 非法 JSON 入参返回 ok:false 不抛出", async () => {
    const result = await makeRegistry().execute(
      { id: "2", name: "read_file", arguments: "{not json" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /Invalid JSON/);
  });

  it("execute: zod 校验失败返回 ok:false 不抛出", async () => {
    const result = await makeRegistry().execute(
      { id: "3", name: "read_file", arguments: '{"path":123}' },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /Invalid arguments/);
  });

  it("execute: 工具内部崩溃返回 ok:false 不抛出", async () => {
    const registry = makeRegistry();
    registry.register({
      name: "boom",
      description: "always throws",
      schema: z.object({}),
      async execute() {
        throw new Error("boom");
      },
    });
    const result = await registry.execute({ id: "4", name: "boom", arguments: "{}" }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.output, /crashed: boom/);
  });
});
