/**
 * 极简 DI 容器：约定注入键 "llm"、"tools"。
 */
export class Context {
  private services = new Map<string, unknown>();

  constructor(
    public readonly workspace: string,
    public readonly config: import("../agent/types.js").AgentConfig,
  ) {}

  provide<T>(key: string, value: T): void {
    this.services.set(key, value);
  }

  resolve<T>(key: string): T {
    const value = this.services.get(key);
    if (value === undefined) {
      throw new Error(
        `Service "${key}" is not registered in Context. Available: [${[...this.services.keys()].join(", ") || "none"}]`,
      );
    }
    return value as T;
  }

  has(key: string): boolean {
    return this.services.has(key);
  }
}
