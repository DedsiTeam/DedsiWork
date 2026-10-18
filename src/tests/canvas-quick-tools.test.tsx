import { expect, test } from "bun:test";
import { CanvasQuickTools } from "../web/components/canvas-quick-tools";
import { canvasNodeSchema } from "../shared/canvas-note";

test("generation toolbar does not forward React click events as prompt text", () => {
  for (const kind of ["container", "text", "image"] as const) {
    const calls: unknown[][] = [];
    const view = CanvasQuickTools({
      value: canvasNodeSchema.parse({
        id: crypto.randomUUID(),
        kind,
        x: 0,
        y: 0,
        width: 390,
        height: 844,
        ...(kind === "image" ? { src: "data:image/png;base64,aA==" } : {}),
      }),
      busy: false,
      onChange: () => {},
      onRemove: () => {},
      onLayer: () => {},
      onGenerateUI: (...args: unknown[]) => {
        calls.push(args);
      },
    });
    const button = view.props.children[0];
    button.props.onClick({ type: "click", currentTarget: {}, nativeEvent: {} });
    expect(calls).toEqual([[]]);
  }
});
