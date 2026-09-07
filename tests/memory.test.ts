import assert from "node:assert/strict";
import { afterAll, describe, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MarkdownMemoryService, SOUL_TEMPLATE, initSoul } from "../src/core/memory.js";
import { buildSystemPrompt, SYSTEM_PROMPT } from "../src/agent/prompt.js";
import { createSession } from "../src/core/session.js";
import { Agent, type AgentEvent } from "../src/agent/agent.js";
import { Context } from "../src/core/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read-file.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { AgentConfig, ChatMessage, LLMResponse } from "../src/agent/types.js";

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-test-"));

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

let wsSeq = 0;
/** 每个 memory 实例用独立子目录，避免测试间 SOUL.md 状态泄漏 */
async function freshWorkspace(): Promise<string> {
  return path.join(tmpRoot, `ws-${++wsSeq}`);
}

function makeMemory(workspace: string): MarkdownMemoryService {
  return new MarkdownMemoryService(workspace);
}

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

describe("MarkdownMemoryService", () => {
  it("loadSoul 不存在 → 空串", async () => {
    const memory = makeMemory(await freshWorkspace());
    assert.equal(await memory.loadSoul(), "");
  });

  it("saveSoul 自动创建 .agent 目录并可读回", async () => {
    const ws = await freshWorkspace();
    const memory = makeMemory(ws);
    await memory.saveSoul("# Soul\n\n## User Preferences\n- Prefer TypeScript over Python.");
    const loaded = await memory.loadSoul();
    assert.match(loaded, /Prefer TypeScript over Python\./);
    // 文件锚定 <workspace>/.agent/SOUL.md
    assert.ok(memory.file.includes(path.join(".agent", "SOUL.md")));
    const stat = await fs.stat(path.join(ws, ".agent", "SOUL.md"));
    assert.ok(stat.isFile());
  });

  it("不同 workspace 的 memory 互相隔离", async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-other-"));
    const m1 = makeMemory(await freshWorkspace());
    const m2 = new MarkdownMemoryService(other);
    await m1.saveSoul("workspace one soul");
    assert.equal(await m2.loadSoul(), "");
    assert.equal(await m1.loadSoul(), "workspace one soul");
    await fs.rm(other, { recursive: true, force: true });
  });
});

describe("/init 命令语义", () => {
  it("/init：Soul 不存在 → 用模板创建", async () => {
    const memory = makeMemory(await freshWorkspace());
    const reply = await initSoul(memory);
    assert.match(reply, /created from template/);
    assert.equal(await memory.loadSoul(), SOUL_TEMPLATE);
  });

  it("/init 已存在且无参数 → 提示已存在，不覆盖", async () => {
    const memory = makeMemory(await freshWorkspace());
    await memory.saveSoul("custom soul content");
    const reply = await initSoul(memory);
    assert.match(reply, /already exists/);
    assert.equal(await memory.loadSoul(), "custom soul content");
  });

  it("/init <pref>：创建并写入初始偏好到 User Preferences 段", async () => {
    const memory = makeMemory(await freshWorkspace());
    const reply = await initSoul(memory, "Prefer TypeScript over Python.");
    assert.match(reply, /initial preference/);
    const soul = await memory.loadSoul();
    assert.match(soul, /## User Preferences\n- Prefer TypeScript over Python\./);
  });

  it("/init <pref> 已存在 → 追加偏好，不覆盖既有内容", async () => {
    const memory = makeMemory(await freshWorkspace());
    await initSoul(memory, "pref one");
    await initSoul(memory, "pref two");
    const soul = await memory.loadSoul();
    assert.match(soul, /- pref one/);
    assert.match(soul, /- pref two/);
    assert.match(soul, /## Persistent Facts/); // 模板其余段保留
  });
});

describe("buildSystemPrompt（Prompt Assembly）", () => {
  it("无 soul/goal/plan → 纯 SYSTEM_PROMPT，无空标题噪声", () => {
    const p = buildSystemPrompt({});
    assert.equal(p, SYSTEM_PROMPT);
    assert.ok(!p.includes("# Persistent Memory"));
    assert.ok(!p.includes("# Current Goal"));
    assert.ok(!p.includes("# Current Plan"));
  });

  it("有 soul → Persistent Memory 段在 SYSTEM_PROMPT 之后", () => {
    const p = buildSystemPrompt({ soul: "Prefer TypeScript over Python." });
    const pmIdx = p.indexOf("# Persistent Memory");
    assert.ok(pmIdx > 0);
    assert.match(p, /# Persistent Memory\nPrefer TypeScript over Python\./);
    assert.ok(p.startsWith(SYSTEM_PROMPT));
  });

  it("goal/plan 非空 → 段落按 Goal → Plan 顺序出现；空 → 省略", () => {
    const p = buildSystemPrompt({ soul: "S", goal: "Finish task X", plan: "1. do A\n2. do B" });
    const gIdx = p.indexOf("# Current Goal");
    const plIdx = p.indexOf("# Current Plan");
    const pmIdx = p.indexOf("# Persistent Memory");
    assert.ok(pmIdx < gIdx && gIdx < plIdx);
    assert.match(p, /# Current Goal\nFinish task X/);
    assert.match(p, /# Current Plan\n1\. do A\n2\. do B/);

    const onlyGoal = buildSystemPrompt({ goal: "G" });
    assert.match(onlyGoal, /# Current Goal\nG/);
    assert.ok(!onlyGoal.includes("# Current Plan"));
  });

  it("确定性：相同输入输出逐字节相同（稳定前缀）", () => {
    const a = buildSystemPrompt({ soul: "S", goal: "G" });
    const b = buildSystemPrompt({ soul: "S", goal: "G" });
    assert.equal(a, b);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(a)); // 无时间戳混入
  });
});

describe("Agent × Soul 注入（Mock LLM）", () => {
  it("新 Session 首 turn：Soul 进入 system 消息的 Persistent Memory 段，并发 memory_loaded 事件", async () => {
    const ws = await freshWorkspace();
    const memory = makeMemory(ws);
    await initSoul(memory, "Prefer TypeScript over Python.");

    const config: AgentConfig = { workspace: ws, maxSteps: 5, apiKey: "unused", model: "mock" };
    const ctx = new Context(config.workspace, config);
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    ctx.provide("tools", tools);
    ctx.provide("memory", memory);

    const llm = new ScriptedLLM([{ type: "final", text: "ok" }]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const events: AgentEvent[] = [];
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config, (e) => events.push(e));

    const session = createSession();
    await agent.run(session, "Create a small script.");

    // system 消息包含 Soul（跨 Session 生效的长期偏好）
    const sys = llm.receivedMessages[0]![0]!;
    assert.equal(sys.role, "system");
    if (sys.role === "system") {
      assert.match(sys.content, /Prefer TypeScript over Python\./);
      assert.match(sys.content, /# Persistent Memory/);
      assert.ok(sys.content.startsWith(SYSTEM_PROMPT));
    }
    // memory_loaded 事件带 soul 字符数
    const memEvents = events.filter(
      (e): e is Extract<AgentEvent, { type: "memory_loaded" }> => e.type === "memory_loaded",
    );
    assert.equal(memEvents.length, 1);
    assert.equal(memEvents[0]!.sessionId, session.id);
    assert.ok(memEvents[0]!.soulChars > 0);
  });

  it("无 memory 服务 → 行为回退为纯 SYSTEM_PROMPT", async () => {
    const ws = await freshWorkspace();
    const config: AgentConfig = { workspace: ws, maxSteps: 5, apiKey: "unused", model: "mock" };
    const ctx = new Context(config.workspace, config);
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    const llm = new ScriptedLLM([{ type: "final", text: "ok" }]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config);
    await agent.run(createSession(), "hi");
    const sys = llm.receivedMessages[0]![0]!;
    if (sys.role === "system") {
      assert.equal(sys.content, SYSTEM_PROMPT);
    }
  });

  it("Soul 只在首 turn 注入一次（第二 turn 不重复 load / 前缀稳定）", async () => {
    const ws = await freshWorkspace();
    const config: AgentConfig = { workspace: ws, maxSteps: 5, apiKey: "unused", model: "mock" };
    const ctx = new Context(config.workspace, config);
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    const memory = makeMemory(ws);
    await initSoul(memory, "Keep answers short."); // 先有 Soul，才能验证前缀跨 turn 稳定
    ctx.provide("memory", memory);
    const llm = new ScriptedLLM([
      { type: "final", text: "t1" },
      { type: "final", text: "t2" },
    ]);
    ctx.provide("llm", llm as unknown as LLMProvider);
    const events: AgentEvent[] = [];
    const agent = new Agent(llm as unknown as LLMProvider, tools, ctx, config, (e) => events.push(e));
    const session = createSession();
    await agent.run(session, "task 1");
    await agent.run(session, "task 2");

    assert.equal(events.filter((e) => e.type === "memory_loaded").length, 1);
    const sys = llm.receivedMessages[1]![0]!;
    assert.equal(sys.role, "system");
    if (sys.role === "system") {
      assert.match(sys.content, /# Persistent Memory/); // 前缀仍在
    }
  });
});
