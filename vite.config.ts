// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only; this project pins its deployment preset below), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    // EAS publishes ESM that imports named exports from lodash's CommonJS build.
    // Bundle both dependencies together so Vite dev SSR applies one interop boundary.
    ssr: {
      noExternal: ["@ethereum-attestation-service/eas-sdk", "lodash"],
    },
  },
  // Pin self-hosted production artifacts to Vercel's Build Output API instead
  // of the wrapper's Cloudflare fallback. Platform env auto-detection is not
  // used, so local and Vercel CI builds produce the same deployable layout.
  nitro: {
    preset: "vercel",
  },
  tanstackStart: {
    router: {
      routeFileIgnorePattern: "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
    },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
