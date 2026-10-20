import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { homedir } from "node:os";
const root = resolve(import.meta.dir, "..");
// Existing shells may not yet see the PATH updated by rustup.
const cargoBin = join(homedir(), ".cargo", "bin");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
);
env.PATH = `${cargoBin}${delimiter}${process.env.PATH || process.env.Path || ""}`;
if (
  !existsSync(
    join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo"),
  ) &&
  !Bun.which("cargo")
) {
  console.error(
    "请先通过 https://rustup.rs 安装 Rust；macOS 需要 Xcode Command Line Tools，Windows 需要 Visual Studio C++ Build Tools 与 Windows SDK。",
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
    ...(command === "dev"
      ? ["--config", resolve(root, "src-tauri/tauri.dev.conf.json")]
      : []),
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
