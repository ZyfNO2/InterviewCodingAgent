import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // 只跑 tests/ 下的 TS 测试；dist / dist-test 是编译产物，避免重复执行
    exclude: ["**/node_modules/**", "dist/**", "dist-test/**"],
    environment: "node",
    testTimeout: 15000,
  },
});
