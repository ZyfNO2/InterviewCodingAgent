import OpenAI from "openai";
import type {
  AgentConfig,
  ChatMessage,
  LLMResponse,
  ToolCall,
} from "../agent/types.js";

/**
 * OpenAI-compatible LLM 封装（baseURL 可指向 compatible 端点）。
 */
export class LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], tools?: unknown[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(tools && tools.length > 0
        ? { tools: tools as OpenAI.ChatCompletionTool[], tool_choice: "auto" as const }
        : {}),
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("LLM response contained no choices");
    }
    const message = choice.message;

    const calls: ToolCall[] = (message.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => {
        const fn = (tc as { id: string; function: { name: string; arguments: string } }).function;
        return { id: tc.id, name: fn.name, arguments: fn.arguments };
      });

    if (calls.length > 0) {
      return { type: "tool_calls", calls };
    }
    return { type: "final", text: message.content ?? "" };
  }
}
