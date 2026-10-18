import { useEffect, useRef } from "react";
import type { AlignmentGuide } from "../../shared/canvas-guides";

export function CanvasGuides({
  getGuides,
}: {
  getGuides: () => AlignmentGuide[];
}) {
  const path = useRef<SVGPathElement>(null);
  const latest = useRef(getGuides);
  latest.current = getGuides;
  useEffect(() => {
    let frame = 0;
    let previous = "";
    const update = () => {
      const next = latest
        .current()
        .map((g) => `M${g.x1},${g.y1}L${g.x2},${g.y2}`)
        .join(" ");
      if (next !== previous) {
        path.current?.setAttribute("d", next);
        previous = next;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <svg className="note-alignment-guides" aria-hidden="true">
      <path ref={path} />
    </svg>
  );
}
