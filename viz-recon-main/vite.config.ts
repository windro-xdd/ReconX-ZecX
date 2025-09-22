import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const baseUrl = env.VITE_API_BASE_URL as string | undefined;
  const isAbsolute = baseUrl && (baseUrl.startsWith("http://") || baseUrl.startsWith("https://"));
  const target = isAbsolute ? baseUrl!.replace(/\/$/, "") : "http://localhost:8000";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
