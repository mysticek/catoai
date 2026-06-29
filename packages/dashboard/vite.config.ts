import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mission Control is served by the desktop agent in production, but during dev it
// runs on Vite and talks to the agent's WebSocket (default ws://localhost:7842).
export default defineConfig({
  plugins: [react()],
  server: { port: 5273, host: true },
  build: { outDir: "dist", target: "es2022" },
});
