import { defineConfig } from "vitest/config";
import path from "node:path";
import { existsSync } from "node:fs";

// Local dev: .env.local carries the Supabase project values (gitignored). CI
// sets the same variables directly via the workflow's `env:` block instead.
if (existsSync(path.resolve(__dirname, ".env.local"))) {
  process.loadEnvFile(path.resolve(__dirname, ".env.local"));
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
