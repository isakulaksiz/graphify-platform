import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: {
      // Arayüz ile API'yi aynı origin'de gösterir; CORS ve token sızıntısı derdi olmaz.
      "/api": {
        target: process.env.CONTROL_API_URL ?? "http://localhost:8090",
        changeOrigin: true,
      },
    },
  },
});
