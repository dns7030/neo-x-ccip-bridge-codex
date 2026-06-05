import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: ["neo-x-ccip-bridge-codex-production.up.railway.app"]
  }
});
