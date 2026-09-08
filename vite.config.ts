import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  if (command === "build" && process.env.VERCEL) {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before deploying.");
    }
    if (new URL(env.VITE_SUPABASE_URL).protocol !== "https:") {
      throw new Error("The deployed Supabase URL must use HTTPS.");
    }
  }
  return {
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  };
});
