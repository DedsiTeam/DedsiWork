import { z } from "zod";

export const designColorRoles = [
  ["primary", "主题色", "--primary"],
  ["secondary", "辅助色", "--secondary"],
  ["background", "背景色", "--background"],
  ["surface", "卡片色", "--card"],
  ["text", "正文色", "--foreground"],
  ["muted", "次要文字", "--muted-foreground"],
  ["border", "边框色", "--border"],
] as const;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const canvasDesignSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(40).default("风格规范"),
  density: z.enum(["compact", "standard", "relaxed"]).default("standard"),
  typography: z.object({
    title: z.number().int().min(12).max(72),
    body: z.number().int().min(10).max(32),
    caption: z.number().int().min(8).max(24),
    titleWeight: z.enum(["500", "600", "700"]),
    bodyWeight: z.enum(["400", "500"]),
    lineHeight: z.number().min(1).max(2),
  }).strict().default({ title: 24, body: 16, caption: 12, titleWeight: "600", bodyWeight: "400", lineHeight: 1.5 }),
  colors: z.object({ primary: color, secondary: color, background: color, surface: color, text: color, muted: color, border: color }).strict(),
  controlRadius: z.number().int().min(0).max(200),
  cardRadius: z.number().int().min(0).max(200),
  buttonRadius: z.number().int().min(0).max(999),
}).strict();
export type CanvasDesign = z.infer<typeof canvasDesignSchema>;
export const designDensities = {
  compact: { label: "紧凑", padding: 16, gap: 8, height: 32 },
  standard: { label: "标准", padding: 24, gap: 16, height: 36 },
  relaxed: { label: "宽松", padding: 32, gap: 24, height: 44 },
} as const;
export function canvasDesignPrompt(design?: CanvasDesign) {
  if (!design?.enabled) return "";
  const density = designDensities[design.density];
  const type = design.typography;
  return `\n\nUI 设计规范「${design.name}」（用于生成图片）：\n` +
    designColorRoles.map(([key, label]) => `${label}：${design.colors[key]}`).join("；") +
    `。\n控件圆角：${design.controlRadius}px；卡片圆角：${design.cardRadius}px；按钮圆角：${design.buttonRadius}px。遵循这些颜色与圆角，保持清晰的视觉层级。
字体：标题 ${type.title}px / 字重 ${type.titleWeight}；正文 ${type.body}px / 字重 ${type.bodyWeight}；辅助文字 ${type.caption}px；正文行高 ${type.lineHeight}。
布局密度：${density.label}；页面内边距 ${density.padding}px；元素间距 ${density.gap}px；控件高度 ${density.height}px。`;
}

// Explicitly selected cards override the note default; do not silently pick one of several.
export function resolveCanvasDesign(cards: CanvasDesign[], fallback?: CanvasDesign) {
  if (cards.length > 1) throw new Error("请只选择一张设计规范卡，再选择原型生成图片");
  return cards.length ? { ...cards[0]!, enabled: true } : fallback;
}
