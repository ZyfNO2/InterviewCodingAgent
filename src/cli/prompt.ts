import * as readline from "node:readline";

/**
 * CLI 交互层共享 readline 封装。
 * Permission 批准、ask_user 提问、交互式任务输入复用同一个接口，
 * 避免多个 readline 同时挂到 stdin 上。
 *
 * 内部维护行缓冲队列：stdin 上到达的行不会因"暂时没有等待者"而丢失
 * （管道输入场景下行事件可能先于 prompt 调用到达）。
 */
let sharedRl: readline.Interface | null = null;
let queue: string[] = [];
let eof = false;
let waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;

function getRl(): readline.Interface {
  if (!sharedRl) {
    sharedRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    sharedRl.on("line", (line: string) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.resolve(line);
      } else {
        queue.push(line);
      }
    });
    sharedRl.on("close", () => {
      eof = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.reject(new Error("stdin closed (EOF) while waiting for input"));
      }
    });
  }
  return sharedRl;
}

/** 提问并读取一行输入；stdin 关闭且无缓冲行时抛错，由调用方决定失败语义。 */
export function prompt(question: string): Promise<string> {
  getRl();
  process.stdout.write(question);
  const buffered = queue.shift();
  if (buffered !== undefined) {
    return Promise.resolve(buffered);
  }
  if (eof) {
    return Promise.reject(new Error("stdin closed (EOF) while waiting for input"));
  }
  return new Promise((resolve, reject) => {
    waiter = { resolve, reject };
  });
}

export function closePrompt(): void {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
    queue = [];
    waiter = null;
  }
}
