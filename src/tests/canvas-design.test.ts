import { canvasAssistantNodes, applyAssistantDesign, canvasAssistantResultSchema } from "../shared/canvas-assistant";
import { cloneCanvasNodes } from "../shared/canvas-clipboard";
import { expect, test } from "bun:test";
import { canvasDesignSchema, canvasDesignPrompt, resolveCanvasDesign } from "../shared/canvas-design";
import { canvasContentSchema } from "../shared/canvas-note";
import { CanvasHistory } from "../shared/canvas-history";
import { canvasUIRequestSchema } from "../shared/canvas-ui";
const design = canvasDesignSchema.parse({ enabled: true, colors: { primary: "#123456", secondary: "#abcdef", background: "#ffffff", surface: "#eeeeee", text: "#111111", muted: "#777777", border: "#cccccc" }, controlRadius: 8, cardRadius: 20, buttonRadius: 999 });
test("design persists with the note and participates in undo without changing elements", () => {
  const old = canvasContentSchema.parse({ nodes: [] });
  expect(old.design).toBeUndefined();
  const content = canvasContentSchema.parse(JSON.parse(JSON.stringify({ ...old, design })));
  const history = new CanvasHistory(old);
  history.record(content);
  expect(history.undo()).toEqual(old);
  expect(history.redo()).toEqual(content);
  expect(content.nodes).toEqual(old.nodes);
});
test("enabled design reaches image instructions; disabled design adds nothing", () => {
  expect(canvasDesignPrompt()).toBe("");
  expect(canvasDesignPrompt({ ...design, enabled: false })).toBe("");
  const prompt = "生成 UI" + canvasDesignPrompt(design);
  expect(prompt).toContain("主题色：#123456");
  expect(prompt).toContain("按钮圆角：999px");
  expect(canvasUIRequestSchema.parse({ prompt, sourceText: "任务清单", width: 390, height: 844 }).prompt).toBe(prompt);
  expect(canvasDesignSchema.safeParse({ ...design, cardRadius: -1 }).success).toBe(false);
  expect(canvasDesignSchema.safeParse({ ...design, colors: { ...design.colors, primary: "invalid" } }).success).toBe(false);
});

test("typography and density migrate and are included in generation instructions", () => {
  expect(design.typography.body).toBe(16);
  expect(design.density).toBe("standard");
  const custom = canvasDesignSchema.parse({ ...design, density: "relaxed", typography: { ...design.typography, title: 32, body: 18 } });
  expect(canvasDesignPrompt(custom)).toContain("标题 32px");
  expect(canvasDesignPrompt(custom)).toContain("页面内边距 32px");
  expect(canvasDesignSchema.safeParse({ ...custom, typography: { ...custom.typography, body: 0 } }).success).toBe(false);
});

test("style cards survive serialization and copying; explicit card overrides default without merging", () => {
  const second = canvasDesignSchema.parse({ ...design, name: "另一种风格", colors: { ...design.colors, primary: "#987654" }, enabled: false });
  const content = canvasContentSchema.parse({ nodes: [{ id: crypto.randomUUID(), kind: "rect", x: 0, y: 0, width: 320, height: 230, designSpec: second }], design });
  const copy = cloneCanvasNodes(content.nodes, 24);
  expect(copy[0]!.id).not.toBe(content.nodes[0]!.id);
  expect(copy[0]!.designSpec).toEqual(second);
  expect(resolveCanvasDesign([second], design)?.colors.primary).toBe("#987654");
  expect(resolveCanvasDesign([second], design)?.enabled).toBe(true);
  expect(resolveCanvasDesign([], design)).toEqual(design);
  expect(() => resolveCanvasDesign([design, second], design)).toThrow("只选择一张");
  expect(canvasContentSchema.parse(JSON.parse(JSON.stringify(content)))).toEqual(content);
});

test("assistant updates original spec in place and preserves unspecified fields", () => {
  const before = canvasContentSchema.parse({ nodes: [
    { id: "11111111-1111-4111-8111-111111111111", kind: "rect", x: 20, y: 40, width: 320, height: 230, designSpec: design },
    { id: "22222222-2222-4222-8222-222222222222", kind: "rect", x: 400, y: 40, width: 320, height: 230, designSpec: design },
  ] });
  const result = canvasAssistantResultSchema.parse({
    reply: "已准备更新", action: "design", targetId: "11111111-1111-4111-8111-111111111111",
    designUpdates: [{ path: "colors.primary", value: "#ff0000" }],
    text: "", imagePrompt: "", width: 320, height: 230, elements: [],
  });
  const after = applyAssistantDesign(result, before);
  expect(after.nodes).toHaveLength(2);
  expect(after.nodes[0]).toEqual({ ...before.nodes[0]!, fill: design.colors.surface, stroke: design.colors.border, designSpec: { ...design, colors: { ...design.colors, primary: "#ff0000" } } });
  expect(after.nodes[1]).toEqual(before.nodes[1]);
  expect(before.nodes[0]!.designSpec).toEqual(design);
  expect(() => applyAssistantDesign({ ...result, targetId: "missing" }, before)).toThrow();
  expect(() => applyAssistantDesign({ ...result, designUpdates: [{ path: "colors.primary", value: "bad" }] }, before)).toThrow();
  const history = new CanvasHistory(before);
  history.record(after);
  expect(history.undo()).toEqual(before);
  expect(history.redo()).toEqual(after);
});

test("assistant creates a real independent style card with complete design and undo", () => {
  const before = canvasContentSchema.parse({ nodes: [] });
  const result = canvasAssistantResultSchema.parse({
    reply: "已准备规范", action: "createDesign", designSpec: design,
    text: "", imagePrompt: "", width: 320, height: 230, elements: [],
  });
  const nodes = canvasAssistantNodes(result, before);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]!.designSpec).toEqual(design);
  expect(nodes[0]!.kind).toBe("rect");
  expect(resolveCanvasDesign([nodes[0]!.designSpec!])!.colors.primary).toBe(design.colors.primary);
  const after = canvasContentSchema.parse({ nodes });
  const second = canvasAssistantNodes(result, after);
  expect(second[0]!.id).not.toBe(nodes[0]!.id);
  expect(second[0]!.x).toBeGreaterThan(nodes[0]!.x + nodes[0]!.width);
  const history = new CanvasHistory(before);
  history.record(after);
  expect(history.undo()).toEqual(before);
  expect(history.redo()).toEqual(after);
  expect(() => canvasAssistantNodes({ ...result, designSpec: null }, before)).toThrow();
});
