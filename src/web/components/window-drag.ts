import { useRef, type PointerEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Move from screen coordinates: macOS borderless windows can lose the native
// mouse-down event while startDragging crosses the asynchronous WebView bridge.
export function useWindowDrag() {
  const dragging = useRef<{
    pointerId: number;
    screenX: number;
    screenY: number;
    origin: Promise<{ position: PhysicalPosition; scale: number }>;
    latest: { x: number; y: number } | null;
    moving: boolean;
  } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!isTauri() || event.button !== 0) return;
    if ((event.target as Element).closest("a, button, input, select, textarea"))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const window = getCurrentWindow();
    dragging.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      origin: Promise.all([window.outerPosition(), window.scaleFactor()]).then(
        ([position, scale]) => ({ position, scale }),
      ),
      latest: null,
      moving: false,
    };
  };
  const onPointerMove = async (event: PointerEvent<HTMLElement>) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.latest = { x: event.screenX, y: event.screenY };
    if (drag.moving) return;
    drag.moving = true;
    try {
      const { position, scale } = await drag.origin;
      while (drag.latest) {
        const latest = drag.latest;
        drag.latest = null;
        await getCurrentWindow().setPosition(
          new PhysicalPosition(
            Math.round(position.x + (latest.x - drag.screenX) * scale),
            Math.round(position.y + (latest.y - drag.screenY) * scale),
          ),
        );
      }
    } catch (error) {
      console.error("无法移动桌面窗口", error);
      dragging.current = null;
    } finally {
      drag.moving = false;
    }
  };
  const onPointerUp = () => {
    dragging.current = null;
  };
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
    onDoubleClick: () => {
      if (isTauri()) void getCurrentWindow().toggleMaximize();
    },
  };
}
