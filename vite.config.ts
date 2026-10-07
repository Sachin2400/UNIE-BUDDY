// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // The base config from @lovable.dev/vite-tanstack-config hardcodes
  // server.host to "::" (IPv6 wildcard), which is meant for Lovable's own
  // cloud sandbox. Many local machines (Windows without IPv6, some
  // WSL/Docker setups, corporate networks) don't support binding to "::"
  // and fail with `EAFNOSUPPORT: address family not supported :::8080`.
  // Override to bind on all IPv4+IPv6 interfaces instead so `npm run dev`
  // works locally.
  vite: {
    server: {
      host: true,
      port: 8080,
    },
  },
});
