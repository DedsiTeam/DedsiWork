import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
// Existing shells may not yet see the PATH updated by rustup.
const cargoBin = join(process.env.USERPROFILE || "", ".cargo", "bin");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
);
env.PATH = `${cargoBin};${process.env.PATH || process.env.Path || ""}`;
if (!existsSync(join(cargoBin, "cargo.exe")) && !Bun.which("cargo")) {
  console.error(
    "请先通过 https://rustup.rs 安装 Rust，并安装 Visual Studio C++ Build Tools 与 Windows SDK。",
  );
  process.exit(1);
}
const command = process.argv[2] || "dev";
if (!["dev", "build", "info"].includes(command))
  throw new Error("desktop command must be dev, build or info");
const child = Bun.spawn(
  [
    process.execPath,
    resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
    command,
    ...process.argv.slice(3),
  ],
  {
    cwd: root,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(await child.exited);
