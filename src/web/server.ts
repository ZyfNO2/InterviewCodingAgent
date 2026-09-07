import "dotenv/config";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Context } from "../core/context.js";
import { Agent, type AgentEvent } from "../agent/agent.js";
import { LLMProvider } from "../llm/provider.js";
import { ToolRegistry } from "../tools/registry.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";
import { shellTool } from "../tools/shell.js";
import { createAskUserTool } from "../tools/ask-user.js";
import { CliPermissionService } from "../core/permission.js";

/**
 * Web 后端（doc 06 接线）：把 Mock 前端接到真实 Runtime。
 *
 * 端点形状迁就已落地前端（doc 06 A.2 的理想形状是 POST /run + sessionId，
 * 这里按前端现状实现单会话版）：
 *   GET  /api/run?task=...   → SSE 流（AgentEvent 契约事件逐条下发）
 *   POST /api/reply          → body = AgentReply，resolve 对应 pending ask
 *   GET  /, /index.html, /app.js, /transport.js, /mock.js → 静态托管 web/
 *
 * 事件翻译（运行时事件 → 04 A.3 前端契约）：
 *   run_start          → {type:"message", role:"user", content:task}
 *   tool_call{call}    → {type:"tool_call", id, name, args}
 *   tool_result        → {type:"tool_result", id, name, ok, result}
 *   final{text}        → {type:"done", text}
 *   max_steps_reached  → {type:"error", message}
 *   llm_call / batch   → 忽略（前端不消费）
 *
 * 交互：ask_user 与 permission 各注入一个 Web prompt 闭包——
 *   生成 askId → SSE 发 {type:"ask", id, kind, question} → Promise 挂 pending；
 *   /api/reply 到达时按类型 resolve（approve → "y"/"n"，answer → value）。
 *   不改 ask-user.ts / permission.ts 签名，不改 Agent Loop。
 *
 * 说明：done/error 后保持 SSE 流打开（EventSource 断流会自动重连并重发
 * GET /api/run 造成重复 run），由前端下一次 start() 或页面关闭时关闭。
 *
 * 安全：仅监听 127.0.0.1，无鉴权——本地演示用，勿暴露公网。
 */

const HOST = "127.0.0.1";
const PORT = Number(process.env.WEB_PORT ?? 8046);
const WEB_DIR = path.resolve(import.meta.dirname, "../../web");

/** 前端契约事件（04 A.3），后端只构造不解释 */
type ContractEvent = Record<string, unknown>;

interface PendingAsk {
  kind: "ask_user" | "permission";
  resolve: (value: string) => void;
}

interface Session {
  task: string;
  res: http.ServerResponse;
  pending: Map<string, PendingAsk>;
}

let current: Session | null = null;
let askSeq = 0;

/** 运行时 AgentEvent → 04 A.3 前端契约事件 */
function translateAgentEvent(e: AgentEvent, task: string): ContractEvent | null {
  switch (e.type) {
    case "run_start":
      return { type: "message", role: "user", content: task };
    case "tool_call": {
      let args: unknown;
      try {
        args = JSON.parse(e.call.arguments || "{}");
      } catch {
        args = e.call.arguments; // 非法 JSON 时降级为字符串，前端兼容 string args
      }
      return { type: "tool_call", id: e.call.id, name: e.call.name, args };
    }
    case "tool_result":
      return {
        type: "tool_result",
        id: e.call.id,
        name: e.call.name,
        ok: e.result.ok,
        result: e.result.output,
      };
    case "final":
      return { type: "done", text: e.text };
    case "max_steps_reached":
      return { type: "error", message: `Reached maxSteps (${e.maxSteps}) without a final answer.` };
    default:
      return null; // llm_call / batch 前端不消费，降级为不发
  }
}

/** Web prompt 闭包：发 ask 事件并挂 pending，等 /api/reply resolve */
function makeWebPrompt(
  kind: "ask_user" | "permission",
  send: (e: ContractEvent) => void,
  pending: Map<string, PendingAsk>,
): (question: string) => Promise<string> {
  return (question: string) =>
    new Promise<string>((resolve) => {
      const id = `ask-${++askSeq}`;
      pending.set(id, { kind, resolve });
      send({ type: "ask", id, kind, question });
      // 会话被替换 / SSE 断开时由 closeSession 统一 resolve 兜底
    });
}

/** 关闭当前会话：结束 SSE、清理 pending（permission 拒绝、ask_user 报错回灌） */
function closeSession(): void {
  if (!current) return;
  for (const [, p] of current.pending) {
    if (p.kind === "permission") p.resolve("n");
    else p.resolve("");
  }
  current.pending.clear();
  try {
    if (!current.res.writableEnded) current.res.end();
  } catch {
    /* 连接已断，忽略 */
  }
  current = null;
}

function sendEvent(session: Session, event: ContractEvent): void {
  try {
    if (!session.res.writableEnded) {
      session.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch {
    /* 浏览器已断开（如点击 Stop），静默丢弃；run 结果仍会写 Trace/终端 */
  }
}

/** 组装与 index.ts 相同的 Context/Registry/Agent，仅 prompt 与 onEvent 换成 Web 实现 */
async function startRun(task: string, workspace: string, maxSteps: number, res: http.ServerResponse): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
    return;
  }

  const config = {
    workspace: path.resolve(workspace),
    maxSteps,
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };

  const session: Session = { task, res, pending: new Map() };
  current = session;
  const send = (e: ContractEvent) => sendEvent(session, e);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // user message 由 run_start 事件翻译产生（translateAgentEvent）

  // 与 index.ts 相同的 Runtime 组装；prompt 换成 Web 闭包
  const ctx = new Context(config.workspace, config);
  const llm = new LLMProvider(config);
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  tools.register(writeFileTool);
  tools.register(shellTool);
  tools.register(createAskUserTool(makeWebPrompt("ask_user", send, session.pending)));
  ctx.provide("llm", llm);
  ctx.provide("tools", tools);
  ctx.provide("permission", new CliPermissionService(makeWebPrompt("permission", send, session.pending)));

  const agent = new Agent(llm, tools, ctx, config, (event: AgentEvent) => {
    const contractEvent = translateAgentEvent(event, task);
    if (contractEvent) send(contractEvent);
  });

  try {
    await agent.run(task);
    // done 事件已发出；保持 SSE 打开，避免 EventSource 自动重连导致重复 run
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/transport.js": { file: "transport.js", type: "text/javascript; charset=utf-8" },
  "/mock.js": { file: "mock.js", type: "text/javascript; charset=utf-8" },
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  // ── SSE：启动 run ──
  if (url.pathname === "/api/run" && req.method === "GET") {
    const task = (url.searchParams.get("task") ?? "").trim();
    if (!task) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("missing task");
      return;
    }
    const workspace = url.searchParams.get("workspace") ?? "./examples/demo";
    let maxSteps = Number.parseInt(url.searchParams.get("max-steps") ?? "20", 10);
    if (!Number.isInteger(maxSteps) || maxSteps <= 0 || maxSteps > 100) maxSteps = 20;

    // 单会话：新 run 覆盖旧的
    closeSession();

    const workspaceAbs = path.resolve(workspace);
    try {
      const stat = await fs.stat(workspaceAbs);
      if (!stat.isDirectory()) throw new Error("not a directory");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`workspace not found: ${workspaceAbs}`);
      return;
    }

    console.log(`[web] run start: task="${task}" workspace="${workspaceAbs}"`);
    await startRun(task, workspaceAbs, maxSteps, res);
    return;
  }

  // ── 上行应答：resolve pending ask ──
  if (url.pathname === "/api/reply" && req.method === "POST") {
    let reply: { type?: string; id?: string; value?: string; approved?: boolean };
    try {
      reply = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "invalid JSON body" }));
      return;
    }
    const pending = current?.pending.get(reply.id ?? "");
    if (!pending || !reply.type) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: `no pending ask for id ${reply.id ?? "(none)"}` }));
      return;
    }
    current?.pending.delete(reply.id!);
    if (reply.type === "approve") {
      pending.resolve(reply.approved ? "y" : "n");
    } else if (reply.type === "answer") {
      pending.resolve(reply.value ?? "");
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: `unknown reply type: ${reply.type}` }));
      return;
    }
    console.log(`[web] reply: ${reply.type} id=${reply.id}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── 静态托管 web/（白名单；ES module 需要 http 访问，file:// 会被 CORS 拦） ──
  const staticEntry = STATIC_FILES[url.pathname];
  if (staticEntry && req.method === "GET") {
    try {
      const content = await fs.readFile(path.join(WEB_DIR, staticEntry.file));
      res.writeHead(200, { "Content-Type": staticEntry.type });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("web asset missing");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.log(`[web] Minimal Coding Agent WebUI listening on http://${HOST}:${PORT}`);
  console.log(`[web] open http://${HOST}:${PORT} in your browser (local only — do not expose)`);
});
