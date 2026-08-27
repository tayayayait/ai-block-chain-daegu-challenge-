import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyClientBundle } from "./verify-client-bundle.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDir = resolve(projectRoot, ".vercel", "output");
const configPath = resolve(outputDir, "config.json");
const nitroMetadataPath = resolve(outputDir, "nitro.json");
const functionDir = resolve(outputDir, "functions", "__server.func");

await access(configPath);
await access(nitroMetadataPath);
await access(resolve(functionDir, "index.mjs"));
await access(resolve(functionDir, ".vc-config.json"));

const config = JSON.parse(await readFile(configPath, "utf8"));
const nitroMetadata = JSON.parse(await readFile(nitroMetadataPath, "utf8"));

assert.equal(config.version, 3, "Vercel Build Output API version must be 3");
assert.equal(nitroMetadata.preset, "vercel", "Nitro preset must be vercel");
assert.ok(
  config.routes?.some((route) => route.src === "/(.*)" && route.dest === "/__server"),
  "Vercel output must route unmatched/deep links to the SSR function",
);

const bundleResult = await verifyClientBundle(resolve(outputDir, "static"));

console.log(
  `Vercel build contract verified: Build Output API v3 + SSR catch-all + ${bundleResult.filesScanned} safe client files`,
);
