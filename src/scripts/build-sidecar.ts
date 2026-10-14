import tailwind from "bun-plugin-tailwind";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("当前桌面打包目标为 Windows x64");
mkdirSync(resolve(root, "src-tauri/binaries"), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "server/desktop.ts")],
  target: "bun",
  compile: {
    target: "bun-windows-x64",
    outfile: resolve(
      root,
      "src-tauri/binaries/dedsiwork-service-x86_64-pc-windows-msvc.exe",
    ),
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
