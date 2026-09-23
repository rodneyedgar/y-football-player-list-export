import { mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await esbuild.build({
  entryPoints: [
    path.join(root, "src", "background.ts"),
    path.join(root, "src", "content.ts"),
    path.join(root, "src", "app.ts")
  ],
  bundle: true,
  outdir: distDir,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  sourcemap: false
});

await cp(path.join(root, "src", "manifest.json"), path.join(distDir, "manifest.json"));
await cp(path.join(root, "src", "app.html"), path.join(distDir, "app.html"));
await cp(path.join(root, "src", "app.css"), path.join(distDir, "app.css"));
await cp(path.join(root, "src", "icons"), path.join(distDir, "icons"), { recursive: true });
