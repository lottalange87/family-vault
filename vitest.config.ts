import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./__tests__/setup.ts"],
    include: ["__tests__/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["app/api/**/*.ts", "lib/**/*.ts"],
      exclude: ["node_modules", ".next", "__tests__"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@/db": path.resolve(__dirname, "./db"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@/app": path.resolve(__dirname, "./app"),
    },
  },
});
