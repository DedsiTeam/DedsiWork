import { canvasDesignSchema } from "./canvas-design";
import { z } from "zod";
import {
  canvasNodeSchema,
  canvasContentSchema,
  type CanvasContent,
} from "./canvas-note";
export const canvasAssistantResultSchema = z
  .object({
    reply: z.string().min(1).max(8000),
    action: z.enum(["chat", "text", "prototype", "image", "design", "createDesign"]),
    designSpec: canvasDesignSchema.nullable().default(null),
    targetId: z.string().default(""),
    designUpdates: z.array(z.object({
      path: z.enum(["name", "density", "controlRadius", "cardRadius", "buttonRadius", "colors.primary", "colors.secondary", "colors.background", "colors.surface", "colors.text", "colors.muted", "colors.border", "typography.title", "typography.body", "typography.caption", "typography.titleWeight", "typography.bodyWeight", "typography.lineHeight"]),
      value: z.string(),
    }).strict()).max(20).default([]),
    text: z.string().max(10000),
    width: z.number().int().min(100).max(4000),
    height: z.number().int().min(100).max(4000),
    imagePrompt: z.string().max(4000),
    elements: z
      .array(
        z
          .object({
            kind: z.enum(["text", "rect", "ellipse"]),
            x: z.number().min(0).max(4000),
            y: z.number().min(0).max(4000),
            width: z.number().min(1).max(4000),
            height: z.number().min(1).max(4000),
            text: z.string().max(2000),
            fontSize: z.number().min(8).max(200),
            bold: z.boolean(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
export type CanvasAssistantResult = z.infer<typeof canvasAssistantResultSchema>;
export type CanvasAssistantMessage = {
  id: string;
  prompt: string;
  status: string;
  stage?: string;
  result?: CanvasAssistantResult;
  error?: string;
  jobId: string;
  applied?: boolean;
};
export function canvasAssistantNodes(
  result: CanvasAssistantResult,
  content: CanvasContent,
) {
  const value = canvasAssistantResultSchema.parse(result);
  if (value.action !== "text" && value.action !== "prototype" && value.action !== "createDesign")
    throw new Error("此回复没有可添加的元素");
  const x = content.nodes.length
    ? Math.max(...content.nodes.map((n) => n.x + n.width * n.scaleX)) + 48
    : 80;
  const y = content.nodes.length
    ? Math.min(...content.nodes.map((n) => n.y))
    : 80;
  const id = crypto.randomUUID();
  if (value.action === "text" && !value.text.trim())
    throw new Error("文字内容为空");
  if (value.action === "prototype" && !value.elements.length)
    throw new Error("原型内容为空");
  if (value.action === "createDesign" && !value.designSpec)
    throw new Error("助手未提供完整设计规范，请重新生成");
  const nodes =
    value.action === "createDesign"
      ? [canvasNodeSchema.parse({
          id, kind: "rect", x, y, width: 320, height: 230,
          designSpec: { ...value.designSpec!, enabled: true },
          text: value.designSpec!.name,
          fill: value.designSpec!.colors.surface,
          stroke: value.designSpec!.colors.border,
          textColor: value.designSpec!.colors.text,
          cornerRadius: value.designSpec!.cardRadius,
        })]
      : value.action === "text"
      ? [
          canvasNodeSchema.parse({
            id,
            kind: "text",
            x,
            y,
            width: value.width,
            height: value.height,
            text: value.text,
            fontSize: 16,
            fill: canvasNodeSchema.shape.textColor.parse(undefined),
          }),
        ]
      : [
          canvasNodeSchema.parse({
            id,
            kind: "container",
            x,
            y,
            width: value.width,
            height: value.height,
            text: "",
          }),
          ...value.elements
            .toSorted(
              (a, b) => Number(a.kind === "text") - Number(b.kind === "text"),
            )
            .map((e) => {
              if (e.x + e.width > value.width || e.y + e.height > value.height)
                throw new Error("原型元素超出画面范围，请让助手调整布局");
              return canvasNodeSchema.parse({
                ...e,
                ...(e.kind === "text"
                  ? { fill: canvasNodeSchema.shape.textColor.parse(undefined) }
                  : {}),
                id: crypto.randomUUID(),
                containerId: id,
                x: x + e.x,
                y: y + e.y,
              });
            }),
        ];
  canvasContentSchema.parse({ nodes: [...content.nodes, ...nodes] });
  return nodes;
}


// Apply only explicit changes to the original card, never to the current selection.
export function applyAssistantDesign(result: CanvasAssistantResult, content: CanvasContent): CanvasContent {
  const target = content.nodes.find((n) => n.id === result.targetId);
  if (result.action !== "design" || !target?.designSpec)
    throw new Error("原规范卡不存在，请重新选择规范卡并发送要求");
  if (!result.designUpdates.length) throw new Error("没有可更新的规范设置");
  const design = structuredClone(target.designSpec);
  for (const { path, value } of result.designUpdates) {
    const [group, field] = path.split(".");
    if (group === "colors") {
      (design.colors as Record<string, string>)[field!] = value;
    } else if (group === "typography") {
      (design.typography as Record<string, string | number>)[field!] =
        field!.endsWith("Weight") ? value : Number(value);
    } else {
      (design as unknown as Record<string, unknown>)[path] =
        path.endsWith("Radius") ? Number(value) : value;
    }
  }
  const validated = canvasDesignSchema.parse(design);
  return { ...content, nodes: content.nodes.map((n) => n.id === target.id
    ? { ...n, designSpec: validated, fill: validated.colors.surface, stroke: validated.colors.border }
    : n) };
}
