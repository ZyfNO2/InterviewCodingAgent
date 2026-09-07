// 健壮性直接验证：路径逃逸 / 未知工具 / 非法 JSON / zod 校验失败（不经过 LLM）
import { Context } from "../dist/core/context.js";
import { AllowAllPermissionService } from "../dist/core/permission.js";
import { ToolRegistry } from "../dist/tools/registry.js";
import { readFileTool } from "../dist/tools/read-file.js";
import { writeFileTool } from "../dist/tools/write-file.js";
import { shellTool } from "../dist/tools/shell.js";
import * as path from "node:path";

const ctx = new Context(path.resolve("./examples/demo"), {
  workspace: path.resolve("./examples/demo"),
  maxSteps: 20,
  apiKey: "unused",
  model: "unused",
});
const registry = new ToolRegistry();
registry.register(readFileTool);
registry.register(writeFileTool);
registry.register(shellTool);
// 危险工具 fail-closed：脚本场景注入全放行 Permission
ctx.provide("permission", new AllowAllPermissionService());

const cases = [
  { name: "path escape ../", call: { id: "t1", name: "read_file", arguments: '{"path":"../../.env"}' } },
  { name: "path escape abs C:", call: { id: "t2", name: "read_file", arguments: '{"path":"C:\\\\Windows\\\\win.ini"}' } },
  { name: "unknown tool", call: { id: "t3", name: "no_such_tool", arguments: "{}" } },
  { name: "bad JSON", call: { id: "t4", name: "read_file", arguments: "{not json" } },
  { name: "zod fail", call: { id: "t5", name: "read_file", arguments: '{"wrong":"field"}' } },
  { name: "missing file", call: { id: "t6", name: "read_file", arguments: '{"path":"ghost.txt"}' } },
  { name: "shell nonzero", call: { id: "t7", name: "shell", arguments: '{"command":"node -e \\"process.exit(3)\\""}' } },
  { name: "write escape", call: { id: "t8", name: "write_file", arguments: '{"path":"../escape.txt","content":"x"}' } },
];

let failed = 0;
for (const c of cases) {
  const r = await registry.execute(c.call, ctx);
  const pass = r.ok === false || (c.name === "shell nonzero" && !r.ok);
  // 预期：全部返回 ok:false 且不抛出
  const status = !r.ok ? "PASS" : "UNEXPECTED-OK";
  if (r.ok) failed++;
  console.log(`[${status}] ${c.name}: ${r.output.slice(0, 100).replace(/\n/g, " ")}`);
}

// 边界确认：workspace 根本身允许（写 workspace 内正常文件）
const okWrite = await registry.execute({ id: "t9", name: "write_file", arguments: '{"path":"tmp-ok.txt","content":"fine"}' }, ctx);
console.log(`[${okWrite.ok ? "PASS" : "FAIL"}] normal write inside workspace: ${okWrite.output}`);
if (!okWrite.ok) failed++;

// shell 结果格式检查
const sh = await registry.execute({ id: "t10", name: "shell", arguments: '{"command":"echo hi"}' }, ctx);
console.log(`[${sh.ok && sh.output.startsWith("exit: 0") ? "PASS" : "FAIL"}] shell format: ${JSON.stringify(sh.output)}`);
if (!sh.ok) failed++;

process.exit(failed > 0 ? 1 : 0);
