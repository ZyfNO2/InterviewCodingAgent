import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Agent, type AgentEvent } from "../src/agent/agent.js";
import { createSession, SYSTEM_PROMPT, type AgentSession } from "../src/core/session.js";
import { Context } from "../src/core/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { AgentConfig, ChatMessage, LLMResponse, ToolCall } from "../src/agent/types.js";

/** 脚本化 Mock LLM：记录每轮收到的 messages */
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

function makeEnv() {
  const config: AgentConfig = { workspace: ".", maxSteps: 10, apiKey: "unused", model: "mock" };
  const ctx = new Context(config.workspace, config);
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  ctx.provide("tools", tools);
  return { ctx, tools, config };
}

const call: ToolCall = { id: "call-1", name: "read_file", arguments: '{"path":"a.txt"}' };

describe("AgentSession（doc 09 Step1）", () => {
  it("同一 session 连续两次 run：第二次 messages 含第一次的历史", async () => {
    const { ctx, tools, config } = makeEnv();
    const session = createSession("s-1");
    const llm = new ScriptedLLM([
      { type: "tool_calls", calls: [call] },
      { type: "final", text: "turn-1 done" },
      { type: "final", text: "turn-2 done" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);

    const r1 = await agent.run(session, "task one");
    const r2 = await agent.run(session, "task two");

    assert.equal(r1.finalText, "turn-1 done");
    assert.equal(r2.finalText, "turn-2 done");

    // 第二轮 LLM 收到的 messages = system + task1 全过程 + task2
    // （第一轮有 2 次 chat 调用：tool_calls 轮 + final 轮，故第二轮请求在下标 2）
    const second = llm.receivedMessages[2]!;
    assert.equal(second[0]?.role, "system");
    assert.ok(second.some((m) => m.role === "user" && m.role === "user" && m.content === "task one"));
    assert.ok(second.some((m) => m.role === "tool")); // 第一轮的 tool result 保留
    assert.ok(second.some((m) => m.role === "assistant" && m.role === "assistant" && m.tool_calls?.length)); // 第一轮 assistant 保留
    assert.ok(
      second.some((m) => m.role === "user" && m.role === "user" && m.content === "task two"),
    );
  });

  it("两个 session 互不影响：messages 独立，progress.seenResults 是各自独立的 Set", async () => {
    const { ctx, tools, config } = makeEnv();
    const sA = createSession("s-A");
    const sB = createSession("s-B");
    const llm = new ScriptedLLM([
      { type: "final", text: "a1" },
      { type: "final", text: "a2" },
      { type: "final", text: "b1" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);

    await agent.run(sA, "task A1");
    await agent.run(sA, "task A2");
    await agent.run(sB, "task B1");

    // B 的历史里看不到 A 的任何消息
    const bMessages = llm.receivedMessages[2]!;
    assert.ok(!bMessages.some((m) => JSON.stringify(m).includes("task A")));
    assert.equal(bMessages.filter((m) => m.role === "user").length, 1);
    // A 的历史继续累积
    assert.equal(sA.messages.length > sB.messages.length, true);
    // progress 是独立 Set
    sA.progress.seenResults.add("marker");
    assert.equal(sB.progress.seenResults.has("marker"), false);
    assert.notEqual(sA.progress, sB.progress);
    // goal/plan 占位互不共享
    sA.goal = {};
    assert.equal(sB.goal, undefined);
  });

  it("userTurns 按用户任务数递增，而非按 agent step（一个 turn 内多次 LLM/tool step）", async () => {
    const { ctx, tools, config } = makeEnv();
    const session = createSession();
    // 一个 turn 内 2 个 agent step（tool_calls → final）
    const llm = new ScriptedLLM([
      { type: "tool_calls", calls: [call] },
      { type: "final", text: "done" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);

    await agent.run(session, "one task");
    assert.equal(session.userTurns, 1);
  });

  it("session_start 只在首 turn 发一次；session_turn 每个用户任务一条", async () => {
    const { ctx, tools, config } = makeEnv();
    const session = createSession("s-evt");
    const llm = new ScriptedLLM([
      { type: "final", text: "t1" },
      { type: "final", text: "t2" },
      { type: "final", text: "t3" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const events: AgentEvent[] = [];
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config, (e) => events.push(e));

    await agent.run(session, "task 1");
    await agent.run(session, "task 2");
    await agent.run(session, "task 3");

    const starts = events.filter((e): e is Extract<AgentEvent, { type: "session_start" }> => e.type === "session_start");
    const turns = events.filter((e): e is Extract<AgentEvent, { type: "session_turn" }> => e.type === "session_turn");
    assert.equal(starts.length, 1);
    assert.equal(starts[0]!.sessionId, "s-evt");
    assert.equal(turns.length, 3);
    assert.deepEqual(turns.map((t) => t.userTurns), [1, 2, 3]);
    assert.deepEqual(turns.map((t) => t.task), ["task 1", "task 2", "task 3"]);
  });

  it("system prompt 只在建 session 时入一次（多轮后仍只有一条 system 消息）", async () => {
    const { ctx, tools, config } = makeEnv();
    const session = createSession();
    const llm = new ScriptedLLM([
      { type: "final", text: "t1" },
      { type: "final", text: "t2" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);

    await agent.run(session, "task 1");
    await agent.run(session, "task 2");

    const systemCount = session.messages.filter((m) => m.role === "system").length;
    assert.equal(systemCount, 1);
    assert.equal(session.messages[0]!.role === "system" && session.messages[0].content, SYSTEM_PROMPT);
  });

  it("旧签名 run(task) 仍可用（过渡包装：临时 session，行为与之前一致）", async () => {
    const { ctx, tools, config } = makeEnv();
    const llm = new ScriptedLLM([
      { type: "final", text: "legacy 1" },
      { type: "final", text: "legacy 2" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);

    const r1 = await agent.run("legacy task 1");
    const r2 = await agent.run("legacy task 2");
    assert.equal(r1.finalText, "legacy 1");
    assert.equal(r2.finalText, "legacy 2");
    // 旧签名：两次 run 互不共享历史（每次临时 session）
    const second = llm.receivedMessages[1]!;
    assert.equal(second.filter((m) => m.role === "user").length, 1);
  });

  it("createSession 工厂：id 缺省自动生成，progress 初始化", () => {
    const s1: AgentSession = createSession();
    const s2 = createSession("fixed-id");
    assert.ok(s1.id && s1.id !== s2.id);
    assert.equal(s2.id, "fixed-id");
    assert.equal(s1.userTurns, 0);
    assert.equal(s1.progress.stallRounds, 0);
    assert.equal(s1.progress.completionChecks, 0);
    assert.ok(s1.progress.seenResults instanceof Set);
    assert.equal(s1.messages[0]!.role, "system");
  });
});
