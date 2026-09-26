import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests against a local anvil chain; run via scripts/integration.sh.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.integration.test.ts"],
    env: { NEXT_PUBLIC_MONAD_RPC_URL: process.env.INTEGRATION_RPC_URL ?? "http://127.0.0.1:8546" },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
