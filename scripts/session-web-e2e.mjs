// Web 多会话隔离 + 连续性 E2E（doc 09 C.1 Case 2）
// 场景：Session A 创建 secret-a.txt；Session B 询问"刚创建了什么文件"（不得看到 A 上下文）；
//       Session A 再问自己创建的文件（应记得）。
const BASE = "http://127.0.0.1:8046";

async function runTask(task, sessionId, autoReply) {
  const res = await fetch(`${BASE}/api/run?task=${encodeURIComponent(task)}&sessionId=${sessionId}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
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
      if (event.type === "ask" && autoReply) {
        const body =
          event.kind === "ask_user"
            ? { type: "answer", id: event.id, value: "secret-a.txt" }
            : { type: "approve", id: event.id, approved: true };
        await fetch(`${BASE}/api/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (event.type === "done" || event.type === "error") return events;
    }
  }
  return events;
}

const checks = [];
const add = (name, ok) => {
  checks.push({ name, ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
};

// Turn 1 — Session A：创建 secret-a.txt（ask_user 提供文件名，避免模型自由发挥）
console.log("── Session A turn 1: create secret-a.txt ──");
const evA1 = await runTask(
  "Create a file for me containing the word apple. You do not know the file name; use ask_user to ask me. Do not use the shell tool.",
  "iso-a",
  true,
);
const askA = evA1.find((e) => e.type === "ask");
add("A turn1: ask_user 出现且写入成功", askA?.kind === "ask_user" && evA1.some((e) => e.type === "tool_result" && e.ok && String(e.result).includes("secret-a.txt")));

// Turn 2 — Session B：全新会话，不得看到 A 的上下文
console.log("── Session B: what file did I just create? ──");
const evB = await runTask(
  "What file did I just create? Answer honestly: if you have no prior context about a created file in this conversation, reply exactly UNKNOWN.",
  "iso-b",
  false,
);
const doneB = evB.find((e) => e.type === "done");
const bText = String(doneB?.text ?? "");
add("B: done 收尾", !!doneB);
add("B: 不泄露 A 的上下文（不含 secret-a.txt / apple）", !bText.includes("secret-a.txt") && !/apple/i.test(bText));
console.log(`   B answered: ${bText.slice(0, 120).replace(/\n/g, " ")}`);

// Turn 3 — Session A 再问：应记得 secret-a.txt（Web 端会话连续性）
console.log("── Session A turn 2: what file did we create? ──");
const evA2 = await runTask(
  "What file did you create for me earlier in this conversation? Reply with the file name only.",
  "iso-a",
  false,
);
const doneA2 = evA2.find((e) => e.type === "done");
add("A turn2: 凭会话历史记得 secret-a.txt", !!doneA2 && String(doneA2.text).includes("secret-a.txt"));
console.log(`   A answered: ${String(doneA2?.text ?? "").slice(0, 120).replace(/\n/g, " ")}`);

process.exit(checks.every((c) => c.ok) ? 0 : 1);
