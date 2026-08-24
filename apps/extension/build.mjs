import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, "dist");

async function main() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  // Background: MV3 service worker (ES module).
  await build({
    entryPoints: [resolve(root, "src/background.ts")],
    outfile: resolve(outdir, "background.js"),
    bundle: true,
    format: "esm",
    target: "chrome110",
    logLevel: "info",
  });

  // Content script + popup: klasik script (IIFE).
  await build({
    entryPoints: {
      content: resolve(root, "src/content.ts"),
      popup: resolve(root, "src/popup.ts"),
    },
    outdir,
    bundle: true,
    format: "iife",
    target: "chrome110",
    logLevel: "info",
  });

  await cp(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
  await cp(resolve(root, "src/popup.html"), resolve(outdir, "popup.html"));

  console.log("Eklenti derlendi ->", outdir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
