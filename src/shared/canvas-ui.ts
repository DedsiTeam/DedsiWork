import { z } from "zod";
export const uiImageSchema = z
  .string()
  .max(7000000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
export const canvasUIRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(6000),
    image: uiImageSchema.optional(),
    sourceText: z.string().trim().min(1).max(20000).optional(),
    width: z.number().finite().min(1).max(20000),
    height: z.number().finite().min(1).max(20000),
    revision: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => !!value.image || !!value.sourceText,
    "请提供原型图片或文字需求",
  )
  .refine((value) => !value.revision || !!value.image, "修改 UI 需要参考图片");
export type CanvasUIRequest = z.infer<typeof canvasUIRequestSchema>;
export type CanvasUIJob = {
  id: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  stage: string;
  image?: string;
  error?: string;
};
