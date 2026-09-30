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
  build: {
    rolldownOptions: {
      output: {
        // Library code changes far less often than the app, but by default it is
        // bundled together with app modules (the Supabase client shared a chunk with
        // the auth hook), so every deploy changed the chunk hash and made returning
        // users re-download ~200 KB of unchanged libraries. These libraries are
        // already needed by every route, so giving them their own long-lived
        // chunks changes nothing about what loads first, only what stays cached.
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
            { name: "vendor-router", test: /node_modules[\\/]react-router(-dom)?[\\/]/, priority: 30 },
            { name: "vendor-supabase", test: /node_modules[\\/]@supabase[\\/]/, priority: 30 },
            { name: "vendor-query", test: /node_modules[\\/]@tanstack[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
  };
});
