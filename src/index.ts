import "dotenv/config";
import * as path from "node:path";
import { Context } from "./core/context.js";
import { Agent, type AgentEvent } from "./agent/agent.js";
import { LLMProvider } from "./llm/provider.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { shellTool } from "./tools/shell.js";
import { createAskUserTool } from "./tools/ask-user.js";
import { CliPermissionService } from "./core/permission.js";
import { TraceRecorder } from "./core/trace.js";
import { createSession } from "./core/session.js";
import { MarkdownMemoryService, initSoul } from "./core/memory.js";
import { prompt, closePrompt } from "./cli/prompt.js";
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
  tools.register(createAskUserTool(prompt)); // Feature B：与 Permission 复用同一 readline 封装
  ctx.provide("llm", llm);
  ctx.provide("tools", tools);
  ctx.provide("permission", new CliPermissionService(prompt)); // Feature A：危险工具需人类批准
  ctx.provide("memory", new MarkdownMemoryService(config.workspace)); // doc 10：Soul 长期记忆

  const trace = await TraceRecorder.create(process.cwd()); // 每次启动一个 run-*.jsonl
  console.log(`[trace] recording to ${trace.file}`);

  const agent = new Agent(llm, tools, ctx, config, async (event: AgentEvent) => {
    renderEvent(event);
    // Trace：全量事件（含 LLM 请求/响应）旁路写入 JSONL，不影响终端渲染
    await trace.record({ ts: new Date().toISOString(), event });
  });

  // CLI：单进程 = 单 Session，连续输入沿用同一 session.messages（doc 09）
  const session = createSession();

  // 主循环：任务为空则继续交互读入
  let currentTask = task;
  while (true) {
    if (!currentTask) {
      currentTask = await readTaskInteractively();
      if (!currentTask) break;
    }

    try {
      // doc 10 B.4：/init 命令拦截，不作为任务丢给 LLM（Step 3 由 CommandRouter 统一收口）
      if (currentTask.startsWith("/init")) {
        const pref = currentTask.slice("/init".length).trim();
        const memory = ctx.resolve<MarkdownMemoryService>("memory");
        console.log(await initSoul(memory, pref || undefined));
        currentTask = undefined;
        continue;
      }
      await agent.run(session, currentTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Agent run failed: ${message}`);
    }
    currentTask = undefined; // 回到交互模式
  }
  closePrompt();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
