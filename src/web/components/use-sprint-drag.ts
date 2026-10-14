import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { WorkItem } from "../../shared/work-item";
type DropTarget = { status: WorkItem["status"]; beforeId: string | null };
// Pointer capture keeps card dragging inside the WebView on macOS and Windows.
// Native HTML drag events can be intercepted by the desktop file-drop handler.
export function useSprintDrag(
  disabled: boolean,
  onMove: (
    item: WorkItem,
    status: WorkItem["status"],
    beforeId: string | null,
  ) => void,
) {
  const drag = useRef<{
    item: WorkItem;
    pointerId: number;
    x: number;
    y: number;
    active: boolean;
    latestX: number;
    latestY: number;
    element: HTMLElement;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    x: number;
    y: number;
  } | null>(null);
  function hit(x: number, y: number): DropTarget | null {
    const element = document.elementFromPoint(x, y);
    const column = element?.closest<HTMLElement>("[data-sprint-column]");
    if (!column) return null;
    const card = element?.closest<HTMLElement>("[data-sprint-item]");
    return {
      status: column.dataset.sprintColumn as WorkItem["status"],
      beforeId: card?.dataset.sprintItem || null,
    };
  }
  function cancel() {
    const current = drag.current;
    drag.current = null;
    setDragging(null);
    setDropTarget(null);
    setPreview(null);
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  useEffect(() => {
    if (!dragging) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        suppressClick.current = true;
        cancel();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [dragging]);
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const scroll = () => {
      const current = drag.current;
      const board = current?.element.closest<HTMLElement>(".sprint-board");
      if (current?.active && board) {
        const rect = board.getBoundingClientRect();
        if (current.latestY >= rect.top && current.latestY <= rect.bottom) {
          const delta =
            current.latestX < rect.left + 40
              ? -10
              : current.latestX > rect.right - 40
                ? 10
                : 0;
          if (delta) {
            board.scrollLeft += delta;
            const target = hit(current.latestX, current.latestY);
            setDropTarget((previous) =>
              previous?.status === target?.status &&
              previous?.beforeId === target?.beforeId
                ? previous
                : target?.beforeId === current.item.id
                  ? null
                  : target,
            );
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  function cardProps(item: WorkItem) {
    return {
      "data-sprint-item": item.id,
      "data-movable": !disabled,
      draggable: false,
      onPointerDown(e: PointerEvent<HTMLElement>) {
        suppressClick.current = false;
        if (
          disabled ||
          e.button !== 0 ||
          !e.isPrimary ||
          (e.target as Element).closest(
            ".sprint-card-actions, input, textarea, select",
          )
        )
          return;
        drag.current = {
          item,
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          active: false,
          latestX: e.clientX,
          latestY: e.clientY,
          element: e.currentTarget,
        };
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.pointerId !== e.pointerId || disabled) return;
        current.latestX = e.clientX;
        current.latestY = e.clientY;
        if (!current.active) {
          if (Math.hypot(e.clientX - current.x, e.clientY - current.y) < 6)
            return;
          current.active = true;
          current.element.setPointerCapture(e.pointerId);
          setDragging(item.id);
          suppressClick.current = true;
        }
        e.preventDefault();
        const target = hit(e.clientX, e.clientY);
        setDropTarget(target?.beforeId === item.id ? null : target);
        setPreview({ title: item.title, x: e.clientX + 14, y: e.clientY + 14 });
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.pointerId !== e.pointerId) return;
        const target =
          current.active && !disabled ? hit(e.clientX, e.clientY) : null;
        if (current.active) e.preventDefault();
        cancel();
        if (target && target.beforeId !== item.id)
          onMove(current.item, target.status, target.beforeId);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClickCapture(e: React.MouseEvent<HTMLElement>) {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      },
    };
  }
  return { cardProps, dragging, dropTarget, preview };
}
