import { CanvasFontSize } from "./canvas-font-size";
import { CanvasDimensions } from "./canvas-dimensions";
import {
  Sparkles,
  Bold,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  PaintBucket,
  Square,
  Type,
} from "lucide-react";
import { Button } from "./ui/button";
import type { CanvasNode } from "../../shared/canvas-note";
export function CanvasQuickTools({
  value,
  busy,
  onChange,
  onRemove,
  onLayer,
  onGenerateUI,
}: {
  value: CanvasNode;
  busy: boolean;
  onChange: (update: Partial<CanvasNode>) => void;
  onRemove: () => void;
  onLayer: (front: boolean) => void;
  onGenerateUI?: () => void;
}) {
  const text = value.kind !== "image" && value.kind !== "connector";
  const shape = text && value.kind !== "text";
  const color = (
    label: string,
    field: "fill" | "stroke" | "textColor",
    Icon: typeof Type,
  ) => (
    <label className="note-quick-color" title={label}>
      <Icon aria-hidden="true" />
      <input
        aria-label={label}
        title={label}
        type="color"
        value={value[field]}
        disabled={busy}
        onChange={(e) => onChange({ [field]: e.target.value })}
      />
    </label>
  );
  return (
    <>
      {onGenerateUI && (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onGenerateUI()}
          title={value.uiDesign ? "修改 UI 图片" : "生成 UI 图片"}
          aria-label={value.uiDesign ? "修改 UI 图片" : "生成 UI 图片"}
        >
          <Sparkles />
        </Button>
      )}
      {shape && (
        <CanvasDimensions value={value} busy={busy} onChange={onChange} />
      )}
      {text && (
        <>
          <CanvasFontSize
            value={value.fontSize}
            busy={busy}
            onChange={(fontSize) => onChange({ fontSize })}
          />
          <Button
            size="icon-sm"
            variant={value.bold ? "secondary" : "ghost"}
            title="加粗"
            aria-label="加粗"
            aria-pressed={value.bold}
            disabled={busy}
            onClick={() => onChange({ bold: !value.bold })}
          >
            <Bold />
          </Button>
          {(
            [
              ["left", "文字左对齐", TextAlignStart],
              ["center", "文字居中", TextAlignCenter],
              ["right", "文字右对齐", TextAlignEnd],
            ] as const
          ).map(([align, label, Icon]) => (
            <Button
              key={align}
              size="icon-sm"
              variant={
                (value.textAlign ?? (shape ? "center" : "left")) === align
                  ? "secondary"
                  : "ghost"
              }
              title={label}
              aria-label={label}
              disabled={busy}
              onClick={() => onChange({ textAlign: align })}
            >
              <Icon />
            </Button>
          ))}
          {color(
            shape ? "填充颜色" : "文字颜色",
            "fill",
            shape ? PaintBucket : Type,
          )}
          {shape && color("边框颜色", "stroke", Square)}
          {shape && color("文字颜色", "textColor", Type)}
        </>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        title="置顶"
        aria-label="置顶"
        disabled={busy}
        onClick={() => onLayer(true)}
      >
        <ArrowUpToLine />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title="置底"
        aria-label="置底"
        disabled={busy}
        onClick={() => onLayer(false)}
      >
        <ArrowDownToLine />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title="删除选中元素"
        aria-label="删除选中元素"
        disabled={busy}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </>
  );
}
