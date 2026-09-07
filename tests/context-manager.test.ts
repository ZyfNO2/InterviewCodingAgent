import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DEFAULT_TOOL_RESULT_CHAR_LIMIT,
  resolveToolResultCharLimit,
  truncateToolResultOutput,
} from "../src/core/context-manager.js";
import { Agent, type AgentEvent } from "../src/agent/agent.js";
import { Context } from "../src/core/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { AgentConfig, ChatMessage, LLMResponse, ToolCall } from "../src/agent/types.js";

/** 脚本化 Mock LLM：记录收到的 messages，断言回灌闭环用 */
class ScriptedLLM {
  public receivedMessages: ChatMessage[][] = [];
  constructor(private script: LLMResponse[]) {}
  async chat(messages: ChatMessage[], _tools?: unknown[]): Promise<LLMResponse> {
    this.receivedMessages.push(structuredClone(messages));
    const next = this.script.shift();
    if (!next) throw new Error("ScriptedLLM: no more responses");
    return next;
  }
}

function makeEnv(configOverrides: Partial<AgentConfig> = {}) {
  const config: AgentConfig = {
    workspace: ".",
    maxSteps: 5,
    apiKey: "unused",
    model: "mock",
    ...configOverrides,
  };
  const ctx = new Context(config.workspace, config);
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  ctx.provide("tools", tools);
  return { ctx, tools, config };
}

describe("truncateToolResultOutput（截断函数单测）", () => {
  it("未超限 → 原样返回，truncated=false", () => {
    const r = truncateToolResultOutput("short output", 100);
    assert.deepEqual(r, { truncated: false, contextText: "short output" });
  });

  it("limit<=0 → 关闭截断（超大输出也原样返回）", () => {
    const big = "x".repeat(50_000);
    const r = truncateToolResultOutput(big, 0);
    assert.deepEqual(r, { truncated: false, contextText: big });
  });

  it("超限 → 保留头尾，标注被丢弃的行数与字符数，总长受控", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 10_000; i++) lines.push(`line-${i}`);
    const output = lines.join("\n");
    const limit = 4_000;

    const r = truncateToolResultOutput(output, limit);
    assert.equal(r.truncated, true);

    // 头尾都保留：开头与结尾内容可见
    assert.ok(r.contextText.startsWith("line-1"));
    assert.ok(r.contextText.includes("line-10000"));
    // 标注包含行数与"完整内容见 trace"
    assert.match(r.contextText, /已截断 \d+ 行 \/ \d+ 字符，完整内容见 trace/);
    // 被丢弃的中间行（如 line-5000）不在 Context 中
    assert.ok(!r.contextText.includes("line-5000"));
    // 总长受控：约等于 limit + marker 开销
    assert.ok(r.contextText.length < limit + 200, `len=${r.contextText.length}`);
  });

  it("单行超大输出（无换行）也能按字符截断", () => {
    const oneLine = "a".repeat(100_000);
    const r = truncateToolResultOutput(oneLine, 1_000);
    assert.equal(r.truncated, true);
    assert.ok(r.contextText.length < 1_200);
    assert.match(r.contextText, /完整内容见 trace/);
  });

  it("截断点恰好等于 limit → 不截断", () => {
    const exact = "y".repeat(1_000);
    const r = truncateToolResultOutput(exact, 1_000);
    assert.equal(r.truncated, false);
  });

  it("resolveToolResultCharLimit：未配置=默认值，显式 0=关闭", () => {
    assert.equal(resolveToolResultCharLimit({} as AgentConfig), DEFAULT_TOOL_RESULT_CHAR_LIMIT);
    assert.equal(
      resolveToolResultCharLimit({ toolResultCharLimit: 0 } as AgentConfig),
      0,
    );
    assert.equal(
      resolveToolResultCharLimit({ toolResultCharLimit: 500 } as AgentConfig),
      500,
    );
  });
});

describe("Agent × Tool Result 截断（Mock LLM 集成）", () => {
  function hugeToolScript(hugeOutput: string): {
    llm: ScriptedLLM;
    events: AgentEvent[];
    agent: Agent;
  } {
    const config: AgentConfig = { workspace: ".", maxSteps: 5, apiKey: "unused", model: "mock", toolResultCharLimit: 1_000 };
    const ctx = new Context(config.workspace, config);
    const tools = new ToolRegistry();
    const call: ToolCall = {
      id: "call-huge",
      name: "read_file",
      arguments: JSON.stringify({ path: "big.txt" }),
    };
    const llm = new ScriptedLLM([
      { type: "tool_calls", calls: [call] },
      { type: "final", text: "done" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);

    // 打桩 read_file：绕过文件系统直接返回超大结果
    const fakeRead = { ...readFileTool, execute: async () => ({ ok: true, output: hugeOutput }) };
    tools.register(fakeRead);

    const events: AgentEvent[] = [];
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config, (e) => events.push(e));
    return { llm, events, agent };
  }

  it("截断版进 Context（第二次 LLM 请求可见 marker），完整版进 tool_result 事件（Trace 事实）", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 20_000; i++) lines.push(`row-${i}`);
    const hugeOutput = lines.join("\n");
    const { llm, events, agent } = hugeToolScript(hugeOutput);

    await agent.run("read big.txt");

    // 第二次 LLM 请求中 tool 消息是截断版
    const second = llm.receivedMessages[1]!;
    const toolMsg = second.find((m) => m.role === "tool");
    assert.ok(toolMsg);
    if (toolMsg.role === "tool") {
      assert.match(toolMsg.content, /完整内容见 trace/);
      assert.ok(toolMsg.content.length < 1_500);
      assert.ok(!toolMsg.content.includes("row-10000")); // 中间内容不进 Context
      assert.ok(toolMsg.content.startsWith("row-1")); // 头保留
    }

    // Trace 事实：tool_result 事件携带完整输出
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    assert.ok(toolResultEvent && toolResultEvent.type === "tool_result");
    assert.equal(toolResultEvent.result.output, hugeOutput); // 完整内容在 Trace
  });

  it("截断后 tool_call 与 tool_result 配对完整（无落单）", async () => {
    const hugeOutput = "z".repeat(30_000);
    const { llm, events, agent } = hugeToolScript(hugeOutput);
    await agent.run("read big.txt");

    const second = llm.receivedMessages[1]!;
    const assistantMsgs = second.filter((m) => m.role === "assistant" && m.tool_calls?.length);
    const toolMsgs = second.filter((m) => m.role === "tool");
    // 每个 tool_call 都有配对的 tool_result（call id 一一对应）
    const callIds = assistantMsgs.flatMap((m) => (m.role === "assistant" ? m.tool_calls!.map((c) => c.id) : []));
    const resultIds = toolMsgs.map((m) => (m.role === "tool" ? m.tool_call_id : ""));
    assert.deepEqual(resultIds, callIds);
    assert.equal(callIds.length, 1);
    // 事件流同样配对：tool_call 与 tool_result 数量一致
    assert.equal(events.filter((e) => e.type === "tool_call").length, events.filter((e) => e.type === "tool_result").length);
  });

  it("多个 tool call 混合大小输出：每条 tool 消息独立截断，配对按 id 对齐", async () => {
    const config: AgentConfig = { workspace: ".", maxSteps: 5, apiKey: "unused", model: "mock", toolResultCharLimit: 1_000 };
    const ctx = new Context(config.workspace, config);
    const tools = new ToolRegistry();
    const outputs: Record<string, string> = {
      small: "tiny",
      huge: "h".repeat(40_000),
    };
    const calls: ToolCall[] = [
      { id: "c1", name: "read_file", arguments: '{"path":"small"}' },
      { id: "c2", name: "read_file", arguments: '{"path":"huge"}' },
      { id: "c3", name: "read_file", arguments: '{"path":"small"}' },
    ];
    const llm = new ScriptedLLM([
      { type: "tool_calls", calls },
      { type: "final", text: "ok" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    tools.register({ ...readFileTool, execute: async (args) => ({ ok: true, output: outputs[(args as { path: string }).path]! }) });

    const events: AgentEvent[] = [];
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config, (e) => events.push(e));
    await agent.run("mix");

    const second = llm.receivedMessages[1]!;
    const toolMsgs = second.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool");
    assert.deepEqual(toolMsgs.map((m) => m.tool_call_id), ["c1", "c2", "c3"]);
    assert.equal(toolMsgs[0]!.content, "tiny"); // 小结果原样
    assert.match(toolMsgs[1]!.content, /完整内容见 trace/); // 大结果截断
    assert.equal(toolMsgs[2]!.content, "tiny");
    // Trace（事件）中三条都是完整版
    const resultEvents = events.filter((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result");
    assert.deepEqual(resultEvents.map((e) => e.result.output), ["tiny", outputs.huge, "tiny"]);
  });

  it("toolResultCharLimit: 0 → 关闭截断，Context 收到完整输出（可开关回退）", async () => {
    const config: AgentConfig = { workspace: ".", maxSteps: 5, apiKey: "unused", model: "mock", toolResultCharLimit: 0 };
    const ctx = new Context(config.workspace, config);
    const tools = new ToolRegistry();
    const hugeOutput = "q".repeat(50_000);
    const llm = new ScriptedLLM([
      { type: "tool_calls", calls: [{ id: "c1", name: "read_file", arguments: '{"path":"big.txt"}' }] },
      { type: "final", text: "ok" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    tools.register({ ...readFileTool, execute: async () => ({ ok: true, output: hugeOutput }) });

    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);
    await agent.run("read big.txt");

    const second = llm.receivedMessages[1]!;
    const toolMsg = second.find((m) => m.role === "tool");
    assert.ok(toolMsg && toolMsg.role === "tool");
    assert.equal(toolMsg.content, hugeOutput); // 原始行为回退
    assert.ok(!toolMsg.content.includes("trace"));
  });
});
