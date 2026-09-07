import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { ChatMessage } from "../src/agent/types.js";

// 拦截 openai SDK：LLMProvider 解析逻辑单测不触网
const createMock = vi.fn();
const constructorOpts: unknown[] = [];
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
    constructor(opts: unknown) {
      constructorOpts.push(opts);
    }
  },
}));

const { LLMProvider } = await import("../src/llm/provider.js");

const config = {
  workspace: ".",
  maxSteps: 5,
  apiKey: "test-key",
  baseUrl: "http://localhost:9999/v1",
  model: "mock-model",
};

const messages: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
];

beforeEach(() => {
  createMock.mockReset();
});

describe("LLMProvider 响应解析（mock SDK）", () => {
  it("tool_calls 响应 → { type:'tool_calls', calls:[...] }", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                type: "function",
                id: "call-abc",
                function: { name: "read_file", arguments: '{"path":"a.txt"}' },
              },
              {
                type: "function",
                id: "call-def",
                function: { name: "shell", arguments: '{"command":"echo hi"}' },
              },
            ],
          },
        },
      ],
    });

    const provider = new LLMProvider(config);
    const res = await provider.chat(messages, [{ type: "function", function: { name: "x", description: "", parameters: {} } }]);

    assert.equal(res.type, "tool_calls");
    assert.equal(res.type === "tool_calls" && res.calls.length, 2);
    if (res.type === "tool_calls") {
      assert.deepEqual(res.calls[0], {
        id: "call-abc",
        name: "read_file",
        arguments: '{"path":"a.txt"}',
      });
    }
  });

  it("普通文本响应 → { type:'final', text }", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "the answer", tool_calls: undefined } }],
    });

    const provider = new LLMProvider(config);
    const res = await provider.chat(messages);
    assert.deepEqual(res, { type: "final", text: "the answer" });
  });

  it("content 为 null 且无 tool_calls → final 空文本（不崩溃）", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const provider = new LLMProvider(config);
    const res = await provider.chat(messages);
    assert.deepEqual(res, { type: "final", text: "" });
  });

  it("无 choices → 抛出明确错误", async () => {
    createMock.mockResolvedValue({ choices: [] });

    const provider = new LLMProvider(config);
    await assert.rejects(() => provider.chat(messages), /no choices/);
  });

  it("传入 tools 时请求带 tool_choice:'auto'；无 tools 时不带 tools 字段", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: "ok" } }] });

    const provider = new LLMProvider(config);
    await provider.chat(messages);
    const bareArg = createMock.mock.calls[0]![0] as Record<string, unknown>;
    assert.ok(!("tools" in bareArg));
    assert.ok(!("tool_choice" in bareArg));

    const tools = [{ type: "function", function: { name: "f", description: "", parameters: {} } }];
    await provider.chat(messages, tools);
    const toolArg = createMock.mock.calls[1]![0] as Record<string, unknown>;
    assert.equal(toolArg.tools, tools);
    assert.equal(toolArg.tool_choice, "auto");
    assert.equal(toolArg.model, "mock-model");
  });

  it("constructor 透传 apiKey 与 baseUrl", () => {
    new LLMProvider(config);
    assert.deepEqual(constructorOpts.at(-1), { apiKey: "test-key", baseURL: "http://localhost:9999/v1" });
  });
});
