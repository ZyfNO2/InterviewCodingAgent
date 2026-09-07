import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "../src/agent/agent.js";
import { Context } from "../src/core/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { AgentConfig, ChatMessage, LLMResponse, ToolCall } from "../src/agent/types.js";

/**
 * Mock LLM：可编程响应序列，并记录收到的 messages 以断言回灌闭环。
 * 通过 Context 注入 "llm"（验收 C.4 约定），无需真实网络。
 */
class MockLLM {
  /** 每次调用 chat() 依次弹出一个响应；耗尽后抛错 */
  public responses: LLMResponse[];
  /** 每次 chat() 收到的完整 messages 快照 */
  public receivedMessages: ChatMessage[][] = [];
  public chatCalls = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async chat(messages: ChatMessage[], _tools?: unknown[]): Promise<LLMResponse> {
    this.chatCalls++;
    this.receivedMessages.push(structuredClone(messages));
    const next = this.responses.shift();
    if (!next) {
      throw new Error("MockLLM: no more scripted responses");
    }
    return next;
  }

  /** 最近一次收到的 messages 中 role:"tool" 的内容 */
  lastToolMessages(): { tool_call_id: string; content: string }[] {
    const last = this.receivedMessages[this.receivedMessages.length - 1] ?? [];
    return last
      .filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool")
      .map((m) => ({ tool_call_id: m.tool_call_id, content: m.content }));
  }
}

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-loop-test-"));

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function makeEnv(): { ctx: Context; tools: ToolRegistry; config: AgentConfig } {
  const config: AgentConfig = {
    workspace: tmpRoot,
    maxSteps: 5,
    apiKey: "unused",
    model: "mock",
  };
  const ctx = new Context(tmpRoot, config);
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  ctx.provide("tools", tools);
  return { ctx, tools, config };
}

describe("Agent Loop（Mock LLM 驱动）", () => {
  it("多轮闭环：tool_calls → 执行 → 结果回灌 → final", async () => {
    await fs.writeFile(path.join(tmpRoot, "secret.txt"), "agent-loop-content", "utf-8");

    const { ctx, tools, config } = makeEnv();

    const call: ToolCall = {
      id: "call-1",
      name: "read_file",
      arguments: JSON.stringify({ path: "secret.txt" }),
    };
    const llm = new MockLLM([
      { type: "tool_calls", calls: [call] },
      { type: "final", text: "The file says agent-loop-content" },
    ]);
    ctx.provide("llm", llm); // Mock LLM 通过 Context 注入

    // 架构冻结：不改 Agent 构造签名，用结构化 cast 注入 mock（运行期 duck typing 成立）
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);
    const result = await agent.run("read secret.txt");

    // 最终答案来自第二个 mock 响应
    assert.equal(result.finalText, "The file says agent-loop-content");
    assert.equal(result.stepsUsed, 2);
    assert.equal(llm.chatCalls, 2);

    // 回灌断言：第二次请求里包含 assistant.tool_calls 和 role:"tool" 结果
    const second = llm.receivedMessages[1]!;
    const assistantMsg = second.find((m) => m.role === "assistant");
    assert.ok(assistantMsg);
    assert.equal(assistantMsg.content, null);
    assert.equal(assistantMsg.tool_calls?.[0]?.id, "call-1");
    assert.equal(assistantMsg.tool_calls?.[0]?.type, "function");

    const toolMsg = second.find((m) => m.role === "tool");
    assert.ok(toolMsg);
    assert.equal(toolMsg.tool_call_id, "call-1");
    assert.equal(toolMsg.content, "agent-loop-content");
  });

  it("maxSteps 兜底：模型永远不 final 时返回明确提示", async () => {
    const { ctx, tools, config } = makeEnv();

    const endlessCalls: ToolCall[] = [
      { id: "call-x", name: "read_file", arguments: '{"path":"a.txt"}' },
    ];
    // 预置 maxSteps+1 个 tool_calls 响应，确保耗尽步数而非 mock 耗尽
    const responses: LLMResponse[] = Array.from({ length: config.maxSteps + 1 }, () => ({
      type: "tool_calls",
      calls: endlessCalls,
    }));
    const llm = new MockLLM(responses);
    ctx.provide("llm", llm);

    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);
    const result = await agent.run("loop forever");

    assert.equal(result.stepsUsed, config.maxSteps);
    assert.match(result.finalText, /Reached maxSteps \(5\)/);
    assert.equal(llm.chatCalls, config.maxSteps);
    // 每轮 tool 结果都原样带回（tool_call_id 闭环）
    const toolMsgs = llm.lastToolMessages();
    assert.ok(toolMsgs.length > 0);
    assert.ok(toolMsgs.every((m) => m.tool_call_id === "call-x"));
  });

  it("工具执行失败以错误文本回灌，Loop 不中断", async () => {
    const { ctx, tools, config } = makeEnv();

    const llm = new MockLLM([
      { type: "tool_calls", calls: [{ id: "call-e", name: "read_file", arguments: '{"path":"ghost.txt"}' }] },
      { type: "final", text: "recovered" },
    ]);
    ctx.provide("llm", llm);

    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);
    const result = await agent.run("read ghost.txt");
    assert.equal(result.finalText, "recovered");

    const toolMsg = llm.receivedMessages[1]!.find((m) => m.role === "tool");
    assert.ok(toolMsg);
    assert.match(toolMsg.content, /ENOENT/);
  });

  it("system prompt 与用户任务在最前两条消息", async () => {
    const { ctx, tools, config } = makeEnv();

    const llm = new MockLLM([{ type: "final", text: "done" }]);
    ctx.provide("llm", llm);

    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);
    await agent.run("my task");

    const first = llm.receivedMessages[0]!;
    assert.equal(first[0]?.role, "system");
    assert.equal(first[1]?.role, "user");
    if (first[1]?.role === "user") {
      assert.equal(first[1].content, "my task");
    }
  });
});
