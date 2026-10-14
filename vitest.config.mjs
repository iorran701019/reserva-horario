import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Testes de comportamento dos componentes (npm run test:componentes).
// Sem Supabase real: cada teste faz vi.mock("@/lib/supabaseClient"). Os
// componentes do app são .js com JSX, então o JSX é habilitado também em .js.
export default defineConfig({
  plugins: [react()],
  oxc: {
    include: /\.(js|jsx)$/,
    lang: "jsx",
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{js,jsx}"],
    globals: false,
    restoreMocks: true,
  },
});
