import * as readline from "node:readline/promises";
import type { AgentEvent } from "../agent/agent.js";

/** 参数解析 + readline 交互 + 输出渲染。 */
export function parseArgs(argv: string[]): {
  workspace: string;
  maxSteps: number;
  task?: string;
} {
  const args = argv.slice(2);
  let workspace = process.cwd();
  let maxSteps = 20;
  let task: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--workspace") {
      workspace = requireValue(args[++i], "--workspace");
    } else if (arg === "--max-steps") {
      const raw = requireValue(args[++i], "--max-steps");
      const n = Number.parseInt(raw, 10);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--max-steps must be a positive integer, got "${raw}"`);
      }
      maxSteps = n;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      // 第一个位置参数视为任务
      task = args.slice(i).join(" ");
      break;
    }
  }
  return { workspace, maxSteps, task };
}

function requireValue(value: string | undefined, option: string): string {
  if (value === undefined || value === "") {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function printUsage(): void {
  console.log(`Usage: npm start -- [--workspace <dir>] [--max-steps <n>] [task...]

Options:
  --workspace <dir>   Agent working root directory (default: process.cwd())
  --max-steps <n>     Max agent loop steps (default: 20)

If no task argument is given, it is read interactively from stdin.`);
}

export function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case "tool_call": {
      const summary = event.call.arguments.length > 120
        ? event.call.arguments.slice(0, 120) + "..."
        : event.call.arguments;
      console.log(`\n[step ${event.step}] tool_call: ${event.call.name} ${summary}`);
      break;
    }
    case "tool_result": {
      const preview = event.result.output.length > 300
        ? event.result.output.slice(0, 300) + `...[${event.result.output.length} chars total]`
        : event.result.output;
      console.log(`[step ${event.step}] tool_result (${event.result.ok ? "ok" : "error"}): ${preview}`);
      break;
    }
    case "final":
      console.log(`\n=== Final Answer (step ${event.step}) ===\n${event.text}\n`);
      break;
    case "max_steps_reached":
      console.log(`\n=== Reached maxSteps (${event.maxSteps}) without a final answer ===\n`);
      break;
  }
}

/** 交互式读入任务；Ctrl+D / 空输入退出。 */
export async function readTaskInteractively(): Promise<string | undefined> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("\nEnter your task (empty or Ctrl+D to quit): ");
    const trimmed = answer.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } finally {
    rl.close();
  }
}
