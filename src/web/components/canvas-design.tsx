import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { canvasDesignSchema, designColorRoles, designDensities, type CanvasDesign } from "../../shared/canvas-design";

function themeDesign(): CanvasDesign {
  const theme = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  const colors = Object.fromEntries(designColorRoles.map(([key, , variable]) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = theme.getPropertyValue("--card").trim();
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = theme.getPropertyValue(variable).trim();
    ctx.fillRect(0, 0, 1, 1);
    const rgb = ctx.getImageData(0, 0, 1, 1).data;
    return [key, "#" + [...rgb].slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")];
  }));
  return canvasDesignSchema.parse({ enabled: false, colors, controlRadius: 8, cardRadius: 20, buttonRadius: 999 });
}

export function CanvasDesignPanel({ value, onChange, onClose, disabled, onAdd, editingCard, getAnchor }: {
  onAdd: (design: CanvasDesign) => void; editingCard?: boolean;
  getAnchor?: () => { bounds: { x: number; y: number; width: number; height: number }; width: number; height: number } | null;
  value?: CanvasDesign; onChange: (value: CanvasDesign) => void; onClose: () => void; disabled: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !editingCard || !getAnchor) return;
    let frame = 0;
    const follow = () => {
      const anchor = getAnchor();
      if (anchor) {
        const { bounds, width, height } = anchor;
        const panelWidth = panel.offsetWidth;
        const right = bounds.x + bounds.width + 16;
        const left = right + panelWidth <= width - 16
          ? right
          : Math.max(68, Math.min(width - panelWidth - 16, bounds.x - panelWidth - 16));
        panel.style.left = `${left}px`;
        panel.style.top = `${Math.max(80, Math.min(bounds.y, height - panel.offsetHeight - 16))}px`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      panel.style.removeProperty("left");
      panel.style.removeProperty("top");
    };
  }, [editingCard, getAnchor]);
  const [defaults] = useState(themeDesign);
  const design = value ?? defaults;
  const [error, setError] = useState("");
  function update(next: CanvasDesign) {
    const result = canvasDesignSchema.safeParse(next);
    if (!result.success) { setError("请输入有效的六位色值或圆角范围内的整数。"); return; }
    setError(""); onChange(result.data);
  }
  return <aside ref={panelRef} className={`note-library note-design-panel${editingCard ? " note-design-panel-anchored" : ""}`} aria-label="UI 设计规范">
    <header><strong>UI 设计规范</strong><Button size="icon-sm" variant="ghost" title="关闭设计规范" aria-label="关闭设计规范" onClick={onClose}><X /></Button></header>
    <details open><summary>颜色与圆角</summary>
    <div className="note-design-colors">
      {designColorRoles.map(([key, label]) => <div className="note-design-row" key={key}>
        <span>{label}</span>
        <input type="color" aria-label={`${label}取色`} title={label} value={design.colors[key]} disabled={disabled} onChange={(e) => update({ ...design, colors: { ...design.colors, [key]: e.target.value } })} />
        <input key={design.colors[key]} aria-label={`${label}色值`} defaultValue={design.colors[key]} maxLength={7} disabled={disabled} onBlur={(e) => update({ ...design, colors: { ...design.colors, [key]: e.target.value.trim() } })} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </div>)}
    </div>
    <div className="note-design-radii">
      {([["controlRadius", "控件圆角", 200], ["cardRadius", "卡片圆角", 200], ["buttonRadius", "按钮圆角", 999]] as const).map(([key, label, max]) => <label key={key} className="note-design-row">
        <span>{label}</span><input key={design[key]} type="number" aria-label={label} min={0} max={max} defaultValue={design[key]} disabled={disabled} onBlur={(e) => { if (e.target.value.trim()) update({ ...design, [key]: Number(e.target.value) }); else setError("圆角不能为空。"); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /><span>px</span>
      </label>)}
    </div>
    <p>0 为直角，按钮设为 999 可生成胶囊形。</p>
    </details>
    <details><summary>字体与布局</summary>
      <div className="note-design-radii">
        {([["title", "标题字号", 12, 72], ["body", "正文字号", 10, 32], ["caption", "辅助字号", 8, 24], ["lineHeight", "正文行高", 1, 2]] as const).map(([key, label, min, max]) => <label className="note-design-row" key={key}><span>{label}</span><input key={design.typography[key]} aria-label={label} type="number" min={min} max={max} step={key === "lineHeight" ? 0.1 : 1} defaultValue={design.typography[key]} disabled={disabled} onBlur={(e) => update({ ...design, typography: { ...design.typography, [key]: Number(e.target.value) } })} /><span>{key === "lineHeight" ? "倍" : "px"}</span></label>)}
        <label>标题字重 <select aria-label="标题字重" value={design.typography.titleWeight} disabled={disabled} onChange={(e) => update({ ...design, typography: { ...design.typography, titleWeight: e.target.value as "500" | "600" | "700" } })}><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label>
        <label>正文字重 <select aria-label="正文字重" value={design.typography.bodyWeight} disabled={disabled} onChange={(e) => update({ ...design, typography: { ...design.typography, bodyWeight: e.target.value as "400" | "500" } })}><option value="400">常规</option><option value="500">中等</option></select></label>
        <label>布局密度 <select aria-label="布局密度" value={design.density} disabled={disabled} onChange={(e) => update({ ...design, density: e.target.value as CanvasDesign["density"] })}>{Object.entries(designDensities).map(([key, density]) => <option key={key} value={key}>{density.label}</option>)}</select></label>
      </div>
    </details>
    {error && <p role="alert">{error}</p>}
    {!editingCard && <><Button size="sm" disabled={disabled} draggable={!disabled} onDragStart={(e) => { e.dataTransfer.setData("application/x-dedsi-design", JSON.stringify(design)); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => onAdd(design)}>添加规范卡 · 可拖出</Button>
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => update({ ...defaults, enabled: value?.enabled ?? false })}>恢复默认规范</Button></>}
  </aside>;
}

