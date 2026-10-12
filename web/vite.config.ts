import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // fail loudly if 5173 is taken instead of silently moving
    proxy: { "/api": `http://localhost:${process.env.CASEFLOW_API_PORT ?? 8787}` },
  },
});
