import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// LOCAL DEVELOPMENT ONLY: seeds an anvil chain for UI review (scripts/local-chain.sh).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["scripts/local-seed.test.ts"],
    env: { NEXT_PUBLIC_MONAD_RPC_URL: "http://127.0.0.1:8546", NODE_ENV: "development" },
    testTimeout: 180_000,
  },
});
