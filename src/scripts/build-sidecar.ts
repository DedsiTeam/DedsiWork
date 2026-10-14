import tailwind from "bun-plugin-tailwind";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const targets = {
  "win32-x64": ["bun-windows-x64", "x86_64-pc-windows-msvc.exe"],
  "darwin-arm64": ["bun-darwin-arm64", "aarch64-apple-darwin"],
  "darwin-x64": ["bun-darwin-x64", "x86_64-apple-darwin"],
} as const;
const target =
  targets[`${process.platform}-${process.arch}` as keyof typeof targets];
if (!target) throw new Error("桌面打包支持 Windows x64 和 macOS arm64/x64");
mkdirSync(resolve(root, "src-tauri/binaries"), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "server/desktop.ts")],
  target: "bun",
  compile: {
    target: target[0],
    outfile: resolve(root, `src-tauri/binaries/dedsiwork-service-${target[1]}`),
  },
  plugins: [tailwind],
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log("Desktop service compiled with embedded React assets.");
