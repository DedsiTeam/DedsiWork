import tailwind from "bun-plugin-tailwind";
import { resolve } from "node:path";
const root = import.meta.dir;
const result = await Bun.build({
  entrypoints: [resolve(root, "web/index.html")],
  outdir: resolve(root, "dist"),
  plugins: [tailwind],
  minify: true,
  target: "browser",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log(
  `Built ${result.outputs.length} frontend assets. Backend runs from server/main.ts.`,
);
