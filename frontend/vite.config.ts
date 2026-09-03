import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Mirrors the /gate rewrite in vercel.json so the display-only
      // price chart works in dev too. api.gateio.ws sends no CORS
      // headers, so the browser cannot call it directly.
      "/gate": {
        target: "https://api.gateio.ws",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gate/, ""),
      },
    },
  },
});
