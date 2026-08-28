// Builds frontend/ and copies the result into extension/web/, which is what
// the visualizer webview serves. Generated output; gitignored.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ext = dirname(dirname(fileURLToPath(import.meta.url)));
const frontend = join(dirname(ext), "frontend");
const dist = join(frontend, "dist");
const web = join(ext, "web");

if (!existsSync(join(frontend, "node_modules"))) {
  console.log("installing frontend deps…");
  execFileSync("npm", ["install"], { cwd: frontend, stdio: "inherit" });
}

console.log("building frontend…");
execFileSync("npm", ["run", "build"], { cwd: frontend, stdio: "inherit" });

rmSync(web, { recursive: true, force: true });
cpSync(dist, web, { recursive: true });
console.log(`copied ${dist} -> ${web}`);
