import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/helpers/setup.ts"],
    // One transaction-per-test harness per process; files may run in parallel
    // workers because each worker owns its own pg connection + rollback tx.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
