import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  clearScreen: false,

  resolve: {
    tsconfigPaths: true,
  },

  server: {
    port: 3000,
    strictPort: true,

    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  plugins: [
    tailwindcss(),

    tanstackStart({
      server: {
        entry: "server",
      },
    }),

    nitro(),

    react(),
  ],
});