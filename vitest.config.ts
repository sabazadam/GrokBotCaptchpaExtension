import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sharedSrc = fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@grokbot/shared": sharedSrc,
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
