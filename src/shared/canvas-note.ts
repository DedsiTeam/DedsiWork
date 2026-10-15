import { z } from "zod";
export const fontOptions = [
  { value: "system", label: "默认字体" },
  { value: "PingFang SC", label: "苹方" },
  { value: "Microsoft YaHei", label: "微软雅黑" },
  { value: "Songti SC", label: "宋体" },
  { value: "STKaiti", label: "楷体" },
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "monospace", label: "等宽字体" },
] as const;
export const fontStacks: Record<(typeof fontOptions)[number]["value"], string> =
  {
    system:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    "PingFang SC": '"PingFang SC", "Microsoft YaHei", sans-serif',
    "Microsoft YaHei": '"Microsoft YaHei", "PingFang SC", sans-serif',
    "Songti SC": '"Songti SC", SimSun, serif',
    STKaiti: "STKaiti, KaiTi, serif",
    Arial: 'Arial, "PingFang SC", sans-serif',
    Georgia: 'Georgia, "Songti SC", serif',
    monospace: 'Menlo, Consolas, "PingFang SC", monospace',
  };
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const canvasNodeSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum([
      "text",
      "image",
      "rect",
      "ellipse",
      "triangle",
      "circle",
      "equilateral",
    ]),
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000),
    width: z.number().finite().min(1).max(20000),
    height: z.number().finite().min(1).max(20000),
    scaleX: z.number().finite().min(0.01).max(100).default(1),
    scaleY: z.number().finite().min(0.01).max(100).default(1),
    rotation: z.number().finite().min(-36000).max(36000).default(0),
    fill: color.default("#e9e8fa"),
    stroke: color.default("#a5a1cf"),
    strokeWidth: z.number().min(0).max(20).default(1),
    text: z.string().max(10000).default(""),
    fontSize: z.number().min(8).max(200).default(24),
    bold: z.boolean().default(false),
    fontFamily: z
      .enum([
        "system",
        "PingFang SC",
        "Microsoft YaHei",
        "Songti SC",
        "STKaiti",
        "Arial",
        "Georgia",
        "monospace",
      ])
      .default("system"),
    textColor: color.default("#33343b"),
    src: z
      .string()
      .max(2800000)
      .regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*)$/)
      .default(""),
  })
  .strict()
  .superRefine((node, ctx) => {
    if (node.kind === "image" && !node.src)
      ctx.addIssue({
        code: "custom",
        message: "图片内容不能为空",
        path: ["src"],
      });
    if (node.kind !== "image" && node.src)
      ctx.addIssue({
        code: "custom",
        message: "非图片元素不能包含图片",
        path: ["src"],
      });
  });
export const canvasContentSchema = z
  .object({ nodes: z.array(canvasNodeSchema).max(200) })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.nodes.map((n) => n.id)).size !== value.nodes.length)
      ctx.addIssue({ code: "custom", message: "元素标识重复" });
    if (new TextEncoder().encode(JSON.stringify(value)).length > 6500000)
      ctx.addIssue({
        code: "custom",
        message: "画布内容超过 6 MB，请减少图片数量或尺寸",
      });
  });
export const canvasNoteInputSchema = z
  .object({
    name: z.string().trim().min(1, "请输入无边记名称").max(80),
    content: canvasContentSchema,
  })
  .strict();
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasContent = z.infer<typeof canvasContentSchema>;
export type CanvasNote = z.infer<typeof canvasNoteInputSchema> & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type CanvasNoteSummary = Omit<CanvasNote, "content"> & {
  nodeCount: number;
  preview: string;
};
export type CanvasNoteList = {
  data: CanvasNoteSummary[];
  meta: { total: number; page: number; pageSize: number };
};
export const nodeLabels = {
  text: "文字",
  image: "图片",
  rect: "矩形",
  ellipse: "椭圆",
  triangle: "三角形",
  circle: "正圆",
  equilateral: "正三角形",
};
