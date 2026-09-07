// E2E 冒烟：真实端点跑通 Case 1 / Case 2 / Parallel。
// 前提：npm run build 已完成；.env 已配置（OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL）。
// 用法：node scripts/e2e-smoke.mjs [--out docs/e2e-smoke-log.md]
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
const STEP_TIMEOUT_MS = 180_000;

function runAgent(task, { inputs = [], workspace = "./examples/demo" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["dist/index.js", "--workspace", workspace, "--max-steps", "12", task],
      { cwd: process.cwd(), env: process.env, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`E2E step timed out after ${STEP_TIMEOUT_MS}ms`));
    }, STEP_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    // 预写批准/回答输入；readline 行缓冲队列会按序消费，多余行无害
    for (const line of inputs) {
      child.stdin.write(line + "\n");
    }
    child.stdin.end();
  });
}

const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
  if (!ok) console.log(detail);
}

// ── Case 1：总结文件（read_file → final） ─────────────────────────────
{
  const r = await runAgent("Read README.md and summarize this project in one short paragraph.");
  const output = r.stdout + r.stderr;
  check(
    "Case 1: read_file 调用记录出现",
    r.code === 0 && output.includes("tool_call: read_file"),
    output.slice(-2000),
  );
  check(
    "Case 1: 产出最终自然语言总结",
    output.includes("=== Final Answer") && output.split("=== Final Answer")[1]?.trim().length > 50,
    output.slice(-1500),
  );
  results.push({ name: "Case 1 full log", ok: true, detail: r.stdout });
}

// ── Case 2：创建并运行代码（write_file → shell → final，含两次批准） ──
{
  const r = await runAgent(
    "Create hello.py that prints exactly 'Hello Coding Agent', then run it with python3 and tell me the result. Do not run any other shell commands.",
    { inputs: ["y", "y", "y"] },
  );
  const output = r.stdout + r.stderr;
  check(
    "Case 2: workspace 下出现 hello.py 写入记录",
    r.code === 0 && output.includes("tool_call: write_file"),
    output.slice(-2000),
  );
  check(
    "Case 2: shell 执行输出包含 Hello Coding Agent",
    /tool_result \(ok\)[\s\S]*?Hello Coding Agent/.test(output) || output.includes("Hello Coding Agent"),
    output.slice(-2000),
  );
  check("Case 2: 产出最终答复", output.includes("=== Final Answer"), output.slice(-1500));
  results.push({ name: "Case 2 full log", ok: true, detail: r.stdout });
}

// ── Parallel：一次并行读三个文件 ─────────────────────────────────────
{
  const r = await runAgent(
    "Read package.json, README.md and tsconfig.json, then tell me the project name in one short answer.",
    { workspace: "." },
  );
  const output = r.stdout + r.stderr;
  check(
    "Parallel: 出现 parallel 批次日志",
    output.includes("parallel x3") || output.includes("parallel x2"),
    output.slice(-2000),
  );
  check(
    "Parallel: 三个文件结果按序回灌并得到最终答复",
    output.includes("=== Final Answer") && output.includes("minimal-coding-agent"),
    output.slice(-1500),
  );
  results.push({ name: "Parallel full log", ok: true, detail: r.stdout });
}

// ── 汇总 ────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n=== E2E smoke: ${results.filter((r) => r.name && r.detail !== undefined && r.name.startsWith("Case") || r.name.startsWith("Parallel")).length === 0 ? "" : ""}${failed.length === 0 ? "ALL PASS" : failed.length + " FAILED"} ===`);

if (outFile) {
  const stamp = new Date().toISOString();
  const model = process.env.OPENAI_MODEL ?? "(default)";
  const lines = [
    `# E2E Smoke Log`,
    ``,
    `- 时间: ${stamp}`,
    `- 模型: \`${model}\`（端点来自本地 .env，密钥不入库）`,
    `- 命令: \`node scripts/e2e-smoke.mjs\``,
    ``,
    `## 结果`,
    ``,
    ...results
      .filter((r) => r.name !== undefined && !r.name.includes("full log"))
      .map((r) => `- [${r.ok ? "PASS" : "FAIL"}] ${r.name}`),
    ``,
    `## 日志片段`,
    ``,
  ];
  for (const r of results.filter((r) => r.name.includes("full log"))) {
    lines.push(`### ${r.name}`, "", "```text", String(r.detail).trim(), "```", "");
  }
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, lines.join("\n"), "utf-8");
  console.log(`log written to ${outFile}`);
}

process.exit(failed.length > 0 ? 1 : 0);
