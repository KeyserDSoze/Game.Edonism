import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Local Development API only. Production builds have no proxy or match HUD.
    // Start .NET with ASPNETCORE_URLS=http://127.0.0.1:5080.
    proxy: {
      "/api/dev": {
        target: "http://127.0.0.1:5080",
        changeOrigin: true,
      },
    },
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../shared", import.meta.url)),
      ],
    },
  },
});
