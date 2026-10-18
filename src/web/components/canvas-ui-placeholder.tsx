import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Image } from "lucide-react";

export function CanvasUIPlaceholder({
  getBounds,
  pending,
  label,
  onClick,
  onMove,
}: {
  getBounds: () => {
    host: HTMLElement;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  pending: boolean;
  label: string;
  onClick: () => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const element = useRef<HTMLButtonElement>(null);
  const latest = useRef(getBounds);
  latest.current = getBounds;
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const box = latest.current(),
        node = element.current;
      if (box && node) {
        node.style.transform = `translate(${box.x}px, ${box.y}px)`;
        node.style.width = `${box.width}px`;
        node.style.height = `${box.height}px`;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, []);
  const bounds = getBounds();
  if (!bounds) return null;
  return createPortal(
    <button
      ref={element}
      type="button"
      className="note-ui-placeholder"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        suppressClick.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        event.stopPropagation();
        const dx = event.clientX - active.x, dy = event.clientY - active.y;
        if (!active.moved && Math.hypot(dx, dy) < 4) return;
        active.moved = true;
        suppressClick.current = true;
        onMove(dx, dy);
        active.x = event.clientX;
        active.y = event.clientY;
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        event.stopPropagation();
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressClick.current) { suppressClick.current = false; return; }
        onClick();
      }}
      title="拖动调整位置，生成期间尺寸固定；点击查看任务"
      aria-label={label}
    >
      <span role="status">
        {pending ? (
          <LoaderCircle className="note-ui-spinner" aria-hidden="true" />
        ) : (
          <Image aria-hidden="true" />
        )}
        {label}
      </span>
    </button>,
    bounds.host,
  );
}
