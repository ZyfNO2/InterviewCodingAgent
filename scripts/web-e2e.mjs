// Web E2E：以"前端同款行为"消费 SSE 契约并自动应答 ask。
// 用法：node scripts/web-e2e.mjs <case1|permission-approve|permission-reject|ask_user>
const scenario = process.argv[2] ?? "case1";

const tasks = {
  case1: "Read README.md and summarize this project in one short paragraph.",
  "permission-approve": "Run the shell command 'echo web-permission-demo' and tell me its output. Do not run any other commands.",
  "permission-reject": "Run the shell command 'echo should-not-run' and tell me its output. If denied, report the denial. Do not run any other commands.",
  ask_user: "Create a text file for me containing the word confirmed. I have not told you the file name, so if you need it, use ask_user to ask me. Do not use the shell tool.",
};
const task = tasks[scenario];
if (!task) {
  console.error(`unknown scenario: ${scenario}`);
  process.exit(1);
}

function replyPolicy(ask) {
  switch (scenario) {
    case "permission-approve":
      return ask.kind === "permission" ? { type: "approve", id: ask.id, approved: true } : null;
    case "permission-reject":
      return ask.kind === "permission" ? { type: "approve", id: ask.id, approved: false } : null;
    case "ask_user":
      return ask.kind === "ask_user"
        ? { type: "answer", id: ask.id, value: "web-answer.txt" }
        : { type: "approve", id: ask.id, approved: true }; // 写文件批准
    default:
      return null;
  }
}

const res = await fetch(`http://127.0.0.1:8046/api/run?task=${encodeURIComponent(task)}`);
if (!res.ok || res.headers.get("content-type")?.includes("text/html")) {
  console.error(`unexpected response: ${res.status}`);
  process.exit(1);
}
console.log(`SSE opened: ${res.status} ${res.headers.get("content-type")}`);

const decoder = new TextDecoder();
let buffer = "";
const events = [];
const pendingReplies = [];

async function drainReplies() {
  while (pendingReplies.length > 0) {
    const ask = pendingReplies.shift();
    const body = replyPolicy(ask);
    if (!body) continue;
    const r = await fetch("http://127.0.0.1:8046/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(`  -> replied ${body.type} (http ${r.status})`);
  }
}

const reader = res.body.getReader();
const timeout = setTimeout(() => {
  console.error("TIMEOUT waiting for done/error");
  process.exit(2);
}, 150_000);

outer: while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 2);
    if (!frame.startsWith("data:")) continue;
    const event = JSON.parse(frame.slice(5).trim());
    events.push(event);

    switch (event.type) {
      case "message":
        console.log(`[message ${event.role}] ${String(event.content).slice(0, 80)}`);
        break;
      case "tool_call": {
        const args = typeof event.args === "string" ? event.args : JSON.stringify(event.args);
        console.log(`[tool_call id=${event.id}] ${event.name} ${String(args).slice(0, 80)}`);
        break;
      }
      case "tool_result":
        console.log(`[tool_result id=${event.id}] ${event.name} ok=${event.ok} :: ${String(event.result).slice(0, 80).replace(/\n/g, " ")}`);
        break;
      case "ask":
        console.log(`[ask id=${event.id} kind=${event.kind}] ${String(event.question).slice(0, 80)}`);
        pendingReplies.push(event);
        await drainReplies();
        break;
      case "done":
        console.log(`[done] ${String(event.text).slice(0, 200)}`);
        break outer;
      case "error":
        console.log(`[error] ${event.message}`);
        break outer;
    }
  }
}
clearTimeout(timeout);

// ── 断言 ──
const toolCalls = events.filter((e) => e.type === "tool_call");
const toolResults = events.filter((e) => e.type === "tool_result");
const checks = [];
const add = (name, ok) => {
  checks.push({ name, ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
};

if (scenario === "case1") {
  const call = toolCalls[0], result = toolResults[0];
  add("Case1: 收到 user message", events[0]?.type === "message" && events[0]?.role === "user");
  add("Case1: read_file tool_call 出现", toolCalls.some((e) => e.name === "read_file"));
  add("Case1: tool_call/tool_result 按 id 配对", call && result && result.id === call.id && call.id.length > 0);
  add("Case1: done 事件收尾", events.at(-1)?.type === "done");
}

if (scenario === "permission-approve") {
  const ask = events.find((e) => e.type === "ask");
  add("PermApprove: ask(kind=permission) 出现", ask?.kind === "permission");
  const shellResult = toolResults.find((e) => e.name === "shell");
  add("PermApprove: 批准后 shell 执行成功", shellResult?.ok === true && String(shellResult?.result).includes("web-permission-demo"));
  add("PermApprove: done 收尾", events.at(-1)?.type === "done");
}

if (scenario === "permission-reject") {
  const ask = events.find((e) => e.type === "ask");
  add("PermReject: ask(kind=permission) 出现", ask?.kind === "permission");
  const denied = toolResults.find((e) => String(e.result) === "denied by user");
  add("PermReject: 拒绝 → denied by user 回灌", denied?.ok === false);
  add("PermReject: 流程不崩，done 收尾", events.at(-1)?.type === "done");
}

if (scenario === "ask_user") {
  const ask = events.find((e) => e.type === "ask");
  add("AskUser: ask(kind=ask_user) 出现", ask?.kind === "ask_user");
  const writeFile = toolResults.find((e) => e.name === "write_file");
  add("AskUser: 网页作答后 Agent 恢复并写文件（含答案路径）", writeFile?.ok === true && String(writeFile?.result).includes("web-answer.txt"));
  add("AskUser: done 收尾", events.at(-1)?.type === "done");
}

process.exit(checks.every((c) => c.ok) ? 0 : 1);
