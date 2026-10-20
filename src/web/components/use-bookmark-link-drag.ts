import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
} from "react";
import type { Bookmark, BookmarkGroup } from "../../shared/bookmarks";

type Target = { groupId: string; beforeId: string | null };
export function useBookmarkLinkDrag(
  groups: BookmarkGroup[],
  disabled: boolean,
  workspaceId: string | undefined,
  onMove: (groups: BookmarkGroup[]) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    link: Bookmark;
    groupId: string;
    element: HTMLElement;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    scroll: HTMLElement;
  } | null>(null);
  const suppressClick = useRef(false);
  const positions = useRef(new Map<string, DOMRect>());
  const [preview, setPreview] = useState<{
    link: Bookmark;
    x: number;
    y: number;
  } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  function hit(x: number, y: number): Target | null {
    const section = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-bookmark-group]");
    if (!section || !root.current?.contains(section)) return null;
    const groupId = section.dataset.bookmarkGroup!;
    const cards = Array.from(
      section.querySelectorAll<HTMLElement>("[data-bookmark-link]"),
    ).filter((card) => card.dataset.bookmarkLink !== drag.current?.link.id);
    const before = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return (
        y < rect.top || (y <= rect.bottom && x < rect.left + rect.width / 2)
      );
    });
    return { groupId, beforeId: before?.dataset.bookmarkLink || null };
  }
  function update() {
    const current = drag.current;
    if (!current?.active) return;
    setPreview({ link: current.link, x: current.x, y: current.y });
    setTarget(hit(current.x, current.y));
  }
  function finish(commit = false) {
    const current = drag.current;
    if (!current) return;
    const destination =
      commit && current.active ? hit(current.x, current.y) : null;
    drag.current = null;
    setPreview(null);
    setTarget(null);
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    if (!destination) return;
    const next = groups.map((group) => ({
      ...group,
      links: group.links.filter((link) => link.id !== current.link.id),
    }));
    const group = next.find((item) => item.id === destination.groupId);
    if (!group) return;
    const index = destination.beforeId
      ? group.links.findIndex((link) => link.id === destination.beforeId)
      : group.links.length;
    group.links.splice(index < 0 ? group.links.length : index, 0, current.link);
    if (
      next.every(
        (group, i) =>
          group.links.map((link) => link.id).join() ===
          groups[i]!.links.map((link) => link.id).join(),
      )
    )
      return;
    root.current
      ?.querySelectorAll<HTMLElement>("[data-bookmark-link]")
      .forEach((card) => {
        positions.current.set(
          card.dataset.bookmarkLink!,
          card.getBoundingClientRect(),
        );
      });
    onMove(next);
  }
  useLayoutEffect(() => {
    if (!positions.current.size) return;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.current
        ?.querySelectorAll<HTMLElement>("[data-bookmark-link]")
        .forEach((card) => {
          const previous = positions.current.get(card.dataset.bookmarkLink!);
          if (!previous) return;
          const rect = card.getBoundingClientRect();
          card.animate(
            [
              {
                transform: `translate(${previous.left - rect.left}px, ${previous.top - rect.top}px)`,
              },
              { transform: "translate(0, 0)" },
            ],
            { duration: 220, easing: "ease-out" },
          );
        });
    }
    positions.current.clear();
  }, [groups]);
  useEffect(() => {
    finish();
  }, [disabled, workspaceId]);
  useEffect(() => {
    if (!preview) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
      }
    };
    const cancel = () => finish();
    let frame: number;
    const scroll = () => {
      const current = drag.current;
      if (!current) return;
      const rect = current.scroll.getBoundingClientRect();
      const delta =
        current.y < Math.max(0, rect.top) + 48
          ? -10
          : current.y > Math.min(innerHeight, rect.bottom) - 48
            ? 10
            : 0;
      if (delta) {
        current.scroll.scrollTop += delta;
        update();
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, [!!preview]);
  return {
    root,
    preview,
    target,
    cardProps: (groupId: string, link: Bookmark) => ({
      "data-bookmark-link": link.id,
      "data-link-dragging": preview?.link.id === link.id,
      "data-link-before":
        target?.groupId === groupId && target.beforeId === link.id,
      "data-link-movable": !disabled,
      draggable: false,
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        suppressClick.current = false;
        if (
          disabled ||
          !event.isPrimary ||
          event.button !== 0 ||
          (event.target as Element).closest("button")
        )
          return;
        let scroll = event.currentTarget.parentElement!;
        while (
          scroll.parentElement &&
          !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)
        )
          scroll = scroll.parentElement;
        if (!scroll.parentElement)
          scroll = document.scrollingElement as HTMLElement;
        drag.current = {
          groupId,
          link,
          element: event.currentTarget,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          active: false,
          scroll,
        };
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.x = event.clientX;
        current.y = event.clientY;
        if (
          !current.active &&
          Math.hypot(current.x - current.startX, current.y - current.startY) < 6
        )
          return;
        if (!current.active) {
          current.active = true;
          suppressClick.current = true;
          current.element.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        update();
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.pointerId === event.pointerId) {
          drag.current.x = event.clientX;
          drag.current.y = event.clientY;
          finish(true);
        }
      },
      onPointerCancel: () => finish(),
      onLostPointerCapture: () => finish(),
      onClickCapture: (event: MouseEvent) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      },
    }),
  };
}
