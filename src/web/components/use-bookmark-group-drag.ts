import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { BookmarkGroup } from "../../shared/bookmarks";

// Keep the DOM order stable while dragging so pointer capture and focus survive.
export function useBookmarkGroupDrag(
  groups: BookmarkGroup[],
  disabled: boolean,
  workspaceId: string | undefined,
  onReorder: (groups: BookmarkGroup[]) => void,
) {
  const elements = useRef(new Map<string, HTMLElement>());
  const settling = useRef(new Map<string, number>());
  const drag = useRef<{
    id: string;
    pointerId: number;
    handle: HTMLElement;
    startY: number;
    y: number;
    scroll: HTMLElement;
    scrollTop: number;
    active: boolean;
    target: number;
    slots: { id: string; top: number; height: number }[];
  } | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    offsets: Map<string, number>;
  } | null>(null);

  function update() {
    const current = drag.current;
    if (!current) return;
    const delta =
      current.y - current.startY + current.scroll.scrollTop - current.scrollTop;
    if (!current.active && Math.abs(delta) < 5) return;
    current.active = true;
    const source = current.slots.findIndex((slot) => slot.id === current.id);
    const moving = current.slots[source]!;
    const center = moving.top + moving.height / 2 + delta;
    const remaining = current.slots.filter((slot) => slot.id !== current.id);
    const target = remaining.filter(
      (slot) => center > slot.top + slot.height / 2,
    ).length;
    current.target = target;
    const ordered = [...remaining];
    ordered.splice(target, 0, moving);
    const gap =
      current.slots.length > 1
        ? current.slots[1]!.top -
          current.slots[0]!.top -
          current.slots[0]!.height
        : 0;
    let top = current.slots[0]!.top;
    const offsets = new Map<string, number>();
    for (const slot of ordered) {
      offsets.set(slot.id, slot.id === current.id ? delta : top - slot.top);
      top += slot.height + gap;
    }
    setPreview({ id: current.id, offsets });
  }

  function finish(commit: boolean) {
    const current = drag.current;
    if (!current) return;
    for (const [id, element] of elements.current)
      settling.current.set(id, element.getBoundingClientRect().top);
    drag.current = null;
    setPreview(null);
    if (current.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    if (!commit || !current.active) return;
    const source = groups.findIndex((group) => group.id === current.id);
    if (source < 0 || source === current.target) return;
    const reordered = [...groups];
    const [group] = reordered.splice(source, 1);
    reordered.splice(current.target, 0, group!);
    onReorder(reordered);
  }

  useLayoutEffect(() => {
    if (preview || !settling.current.size) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const [id, top] of settling.current) {
        const element = elements.current.get(id);
        if (!element) continue;
        const delta = top - element.getBoundingClientRect().top;
        if (Math.abs(delta) > 1)
          element.animate(
            [
              { transform: `translateY(${delta}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 200, easing: "ease-out" },
          );
      }
    }
    settling.current.clear();
  });

  useEffect(() => {
    finish(false);
  }, [disabled, workspaceId]);

  useEffect(() => {
    if (!preview) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    const blur = () => finish(false);
    let frame: number;
    const scroll = () => {
      const current = drag.current;
      if (!current) return;
      const rect = current.scroll.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const speed =
        current.y < top + 48 ? -10 : current.y > bottom - 48 ? 10 : 0;
      if (speed) {
        current.scroll.scrollTop += speed;
        update();
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", blur);
    };
  }, [!!preview]);

  return {
    dragging: preview?.id,
    ref: (id: string, element: HTMLElement | null) => {
      if (element) elements.current.set(id, element);
      else elements.current.delete(id);
    },
    style: (id: string) =>
      preview
        ? { transform: `translateY(${preview.offsets.get(id) || 0}px)` }
        : undefined,
    handle: (id: string) => ({
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (disabled || groups.length < 2 || event.button !== 0 || drag.current)
          return;
        event.preventDefault();
        const element = elements.current.get(id)!;
        let scroll = element.parentElement!;
        while (
          scroll.parentElement &&
          !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)
        )
          scroll = scroll.parentElement;
        if (!scroll.parentElement)
          scroll = document.scrollingElement as HTMLElement;
        for (const item of elements.current.values())
          item.getAnimations().forEach((animation) => animation.cancel());
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id,
          pointerId: event.pointerId,
          handle: event.currentTarget,
          startY: event.clientY,
          y: event.clientY,
          scroll,
          scrollTop: scroll.scrollTop,
          active: false,
          target: groups.findIndex((group) => group.id === id),
          slots: groups.map((group) => {
            const rect = elements.current
              .get(group.id)!
              .getBoundingClientRect();
            return { id: group.id, top: rect.top, height: rect.height };
          }),
        };
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current.y = event.clientY;
        update();
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        if (drag.current?.pointerId === event.pointerId) finish(true);
      },
      onPointerCancel: () => finish(false),
      onLostPointerCapture: () => finish(false),
    }),
  };
}
