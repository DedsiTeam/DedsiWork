import type { KeyboardEvent } from "react";
import type { CanvasNode, Connector } from "../../shared/canvas-note";
import {
  connectorTypes,
  connectorArrows,
  lineSettings,
} from "../canvas-connector";
function ChoiceIcon({
  kind,
  value,
  reverse = false,
}: {
  kind: "type" | "style" | "arrow";
  value: string;
  reverse?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 28 22"
      width="28"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={reverse ? { transform: "scaleX(-1)" } : undefined}
    >
      {kind === "type" ? (
        value === "curve" ? (
          <path d="M3 18 C3 2 25 20 25 4" />
        ) : value === "polyline" ? (
          <path d="M3 18 H14 V4 H25" />
        ) : value === "rounded" ? (
          <path d="M3 18 H10 Q14 18 14 14 V8 Q14 4 18 4 H25" />
        ) : (
          <path d="M3 18 L25 4" />
        )
      ) : kind === "style" ? (
        <path
          d="M3 11 H25"
          strokeDasharray={
            value === "dotted" ? ".1 4" : value === "dashed" ? "5 4" : undefined
          }
          strokeWidth={value === "dotted" ? 2.5 : 1.7}
        />
      ) : (
        <>
          <path d={value === "none" ? "M3 11 H25" : "M3 11 H20"} />
          {value === "angle" ? (
            <path d="M18 6 L24 11 L18 16" />
          ) : value === "triangle" ? (
            <path d="M18 6 L24 11 L18 16 Z" fill="currentColor" />
          ) : value === "circle" ? (
            <circle cx="22" cy="11" r="3.2" fill="currentColor" />
          ) : value === "diamond" ? (
            <path d="M18 11 L22 7 L26 11 L22 15 Z" fill="currentColor" />
          ) : null}
        </>
      )}
    </svg>
  );
}
function IconChoices<V extends string>({
  label,
  kind,
  value,
  options,
  onChange,
  reverse = false,
}: {
  label: string;
  kind: "type" | "style" | "arrow";
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange: (value: V) => void;
  reverse?: boolean;
}) {
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index + options.length - 1) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("button")
      [next]?.focus();
  }
  return (
    <div className="note-connector-choice">
      <span>{label}</span>
      <div className="note-icon-radios" role="radiogroup" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            title={option.label}
            aria-label={option.label}
            data-state={value === option.value ? "checked" : "unchecked"}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => keyboard(event, index)}
          >
            <ChoiceIcon kind={kind} value={option.value} reverse={reverse} />
          </button>
        ))}
      </div>
    </div>
  );
}
export function ConnectorProperties({
  value,
  busy,
  onChange,
}: {
  value: CanvasNode;
  busy: boolean;
  onChange: (update: Partial<CanvasNode>) => void;
}) {
  const line = lineSettings(value);
  function patchLine(update: Partial<Connector>) {
    onChange({ line: { ...line, ...update } });
  }
  return (
    <fieldset className="note-connector-properties" disabled={busy}>
      <IconChoices
        label="连线类型"
        kind="type"
        value={line.type}
        options={connectorTypes}
        onChange={(type) => patchLine({ type })}
      />
      <div className="note-property-row">
        <label>
          线条粗细
          <input
            aria-label="线条粗细"
            type="number"
            min={0.5}
            max={20}
            step={0.5}
            value={value.strokeWidth}
            onChange={(e) => {
              if (e.target.value !== "")
                onChange({ strokeWidth: Number(e.target.value) });
            }}
          />
          <span>px</span>
        </label>
      </div>
      <div className="note-property-row">
        <label>
          线条颜色
          <input
            type="color"
            aria-label="线条颜色"
            value={value.stroke}
            onChange={(e) => onChange({ stroke: e.target.value })}
          />
        </label>
      </div>
      <IconChoices
        label="线条样式"
        kind="style"
        value={line.style}
        options={[
          { value: "solid", label: "实线" },
          { value: "dotted", label: "圆点线" },
          { value: "dashed", label: "虚线" },
        ]}
        onChange={(style) => patchLine({ style })}
      />
      <div className="note-inspector-caption">两端箭头</div>
      <IconChoices
        label="起点箭头"
        kind="arrow"
        value={line.startArrow}
        options={connectorArrows}
        reverse
        onChange={(startArrow) => patchLine({ startArrow })}
      />
      <IconChoices
        label="终点箭头"
        kind="arrow"
        value={line.endArrow}
        options={connectorArrows}
        onChange={(endArrow) => patchLine({ endArrow })}
      />
      {line.type !== "straight" && (
        <button
          className="note-connector-reset"
          type="button"
          onClick={() => patchLine({ bend: undefined })}
        >
          重置弯曲 / 拐点
        </button>
      )}
      {(["startBinding", "endBinding"] as const).map(
        (key, index) =>
          line[key] && (
            <div className="note-binding-row" key={key}>
              <span>{index === 0 ? "起点" : "终点"}已吸附形状</span>
              <button
                type="button"
                onClick={() => patchLine({ [key]: undefined })}
              >
                解除
              </button>
            </div>
          ),
      )}
    </fieldset>
  );
}
