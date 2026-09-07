import type { Tool } from "../agent/types.js";
import type { Context } from "./context.js";

/**
 * Permission 能力（阶段二 Feature A）。
 * 危险工具执行前必须经 check() 批准；拒绝时 Registry 返回 denied。
 */
export interface PermissionService {
  check(tool: Tool, args: unknown, ctx: Context): Promise<boolean>;
}

/** 供测试/脚本使用的全放行实现 */
export class AllowAllPermissionService implements PermissionService {
  async check(_tool: Tool, _args: unknown, _ctx: Context): Promise<boolean> {
    return true;
  }
}

/**
 * CLI 交互实现：`Approve <tool> [y/N]:`，展示参数摘要。
 * prompt 函数由 cli 层注入（与 ask_user 复用同一个 readline 封装）。
 * EOF / 读取失败一律视为拒绝（fail-closed）。
 */
export class CliPermissionService implements PermissionService {
  constructor(private readonly prompt: (question: string) => Promise<string>) {}

  async check(tool: Tool, args: unknown, _ctx: Context): Promise<boolean> {
    const summary = summarizeArgs(args);
    let answer: string;
    try {
      answer = await this.prompt(`Approve ${tool.name} ${summary} [y/N]: `);
    } catch {
      return false;
    }
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  }
}

function summarizeArgs(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    text = String(args);
  }
  return text.length > 120 ? text.slice(0, 120) + "..." : text;
}
