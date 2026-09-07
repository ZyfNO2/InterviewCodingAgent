import "dotenv/config";
import * as path from "node:path";
import { Context } from "./core/context.js";
import { Agent, type AgentEvent } from "./agent/agent.js";
import { LLMProvider } from "./llm/provider.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { shellTool } from "./tools/shell.js";
import { parseArgs, readTaskInteractively, renderEvent } from "./cli/cli.js";

async function main(): Promise<void> {
  const { workspace, maxSteps, task } = parseArgs(process.argv);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  const config = {
    workspace: path.resolve(workspace),
    maxSteps,
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };

  // 组装 Context（极简 DI）
  const ctx = new Context(config.workspace, config);
  const llm = new LLMProvider(config);
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  tools.register(writeFileTool);
  tools.register(shellTool);
  ctx.provide("llm", llm);
  ctx.provide("tools", tools);

  const agent = new Agent(llm, tools, ctx, config, (event: AgentEvent) => renderEvent(event));

  // 主循环：任务为空则继续交互读入
  let currentTask = task;
  while (true) {
    if (!currentTask) {
      currentTask = await readTaskInteractively();
      if (!currentTask) break;
    }

    try {
      await agent.run(currentTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Agent run failed: ${message}`);
    }
    currentTask = undefined; // 回到交互模式
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
