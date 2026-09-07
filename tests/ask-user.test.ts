import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { createAskUserTool } from "../src/tools/ask-user.js";
import type { Tool } from "../src/agent/types.js";

describe("Feature B — ask_user tool", () => {
  it("把人类输入作为 ToolResult 回灌", async () => {
    const tool = createAskUserTool(async () => "save it to output/final.txt");
    const result = await tool.execute(
      { question: "文件应该保存在哪里？" },
      {} as never,
    );
    assert.equal(result.ok, true);
    assert.match(result.output, /save it to output\/final\.txt/);
  });

  it("risk=safe 且 parallelSafe=false", () => {
    const tool = createAskUserTool(async () => "any");
    assert.equal(tool.name, "ask_user");
    assert.equal(tool.risk, "safe");
    assert.equal(tool.parallelSafe, false);
  });

  it("zod 校验失败返回 ok:false", async () => {
    const tool = createAskUserTool(async () => "any");
    const result = await tool.execute({ wrong: 1 }, {} as never);
    assert.equal(result.ok, false);
    assert.match(result.output, /Invalid arguments/);
  });

  it("prompt 抛错（EOF）返回 ok:false 不崩溃", async () => {
    const tool = createAskUserTool(async () => {
      throw new Error("stdin closed");
    });
    const result = await tool.execute({ question: "hello?" }, {} as never);
    assert.equal(result.ok, false);
    assert.match(result.output, /stdin closed/);
  });

  it("符合 Tool 统一接口形状", () => {
    const tool = createAskUserTool(async () => "any") as Tool;
    assert.equal(typeof tool.execute, "function");
    assert.ok(tool.schema instanceof z.ZodType);
  });
});
