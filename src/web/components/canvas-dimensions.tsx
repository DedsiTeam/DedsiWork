import { useEffect, useState } from "react";
import { Input } from "./ui/input";
import type { CanvasNode } from "../../shared/canvas-note";

export function CanvasDimensions({
  value,
  busy,
  onChange,
}: {
  value: CanvasNode;
  busy: boolean;
  onChange: (update: Partial<CanvasNode>) => void;
}) {
  const width = Math.round(value.width * value.scaleX);
  const height = Math.round(value.height * value.scaleY);
  const [draft, setDraft] = useState({
    width: String(width),
    height: String(height),
  });
  useEffect(
    () => setDraft({ width: String(width), height: String(height) }),
    [value.id, width, height],
  );
  function commit(field: "width" | "height", text: string) {
    const number = Number(text);
    if (
      !text.trim() ||
      !Number.isFinite(number) ||
      number < 1 ||
      number > 20000
    ) {
      setDraft((previous) => ({
        ...previous,
        [field]: String(field === "width" ? width : height),
      }));
      return;
    }
    if (number === (field === "width" ? width : height)) return;
    onChange(
      field === "width"
        ? { width: number, scaleX: 1 }
        : { height: number, scaleY: 1 },
    );
  }
  return (
    <div className="note-dimensions" role="group" aria-label="元素尺寸">
      {(["width", "height"] as const).map((field) => (
        <label
          key={field}
          title={field === "width" ? "宽度（px）" : "高度（px）"}
        >
          <Input
            data-size="sm"
            type="number"
            min={1}
            max={20000}
            step={1}
            disabled={busy}
            aria-label={field === "width" ? "宽度（px）" : "高度（px）"}
            title={field === "width" ? "宽度（px）" : "高度（px）"}
            value={draft[field]}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                [field]: event.target.value,
              }))
            }
            onBlur={(event) => commit(field, event.currentTarget.value)}
            onPointerLeave={(event) => commit(field, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft((previous) => ({
                  ...previous,
                  [field]: String(field === "width" ? width : height),
                }));
              }
            }}
          />
        </label>
      ))}
    </div>
  );
}
