import {
  useLayoutEffect,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "./ui/button";
type Bounds = { x: number; y: number; width: number; height: number };
export function CanvasInspector({
  children,
  quickActions,
  label,
  getAnchor,
}: {
  children: ReactNode;
  quickActions?: ReactNode;
  label: string;
  getAnchor: () => { bounds: Bounds; width: number; height: number } | null;
}) {
  const element = useRef<HTMLElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [expanded]);
  useLayoutEffect(() => {
    let frame = 0,
      previous = "";
    const follow = () => {
      const panel = element.current,
        anchor = getAnchor();
      if (panel && anchor) {
        const { bounds, width, height } = anchor;
        const w = panel.offsetWidth,
          h = panel.offsetHeight;
        const left = Math.max(
          68,
          Math.min(width - w - 14, bounds.x + bounds.width / 2 - w / 2),
        );
        const above = bounds.y - h - 16;
        const preferred = above >= 80 ? above : bounds.y + bounds.height + 16;
        const top = Math.max(80, Math.min(height - h - 64, preferred));
        if (dropdown.current) {
          const below = height - top - h - 24,
            aboveSpace = top - 88;
          const belowPreferred =
            below >= Math.min(360, dropdown.current.scrollHeight) ||
            below >= aboveSpace;
          dropdown.current.style.top = belowPreferred ? `${h + 8}px` : "auto";
          dropdown.current.style.bottom = belowPreferred
            ? "auto"
            : `${h + 8}px`;
          dropdown.current.style.maxHeight = `${Math.max(80, Math.min(360, belowPreferred ? below : aboveSpace))}px`;
        }
        const next = `${left}:${top}`;
        if (next !== previous) {
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
          previous = next;
        }
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [getAnchor]);
  return (
    <aside
      ref={element}
      className="note-inspector note-context-toolbar"
      aria-label={label}
    >
      <div className="note-quick-actions">{quickActions}</div>
      <Button
        ref={trigger}
        variant={expanded ? "secondary" : "ghost"}
        size="icon-sm"
        title="更多设置"
        aria-label="更多设置"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <Ellipsis />
      </Button>
      {expanded && (
        <div
          ref={dropdown}
          className="note-more-settings"
          role="group"
          aria-label="更多属性设置"
        >
          {children}
        </div>
      )}
    </aside>
  );
}
