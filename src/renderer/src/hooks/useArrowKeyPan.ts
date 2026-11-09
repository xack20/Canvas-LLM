import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { useIsActivePane } from "./useActivePane";

// Screen pixels per second; Shift pans faster.
const PAN_SPEED = 700;
const FAST_MULTIPLIER = 2.5;

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

// Arrow keys belong to these when they hold focus (caret movement, list and
// menu navigation, sliders), so the canvas must not steal them.
function ownsArrows(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.closest('[role="listbox"],[role="menu"],[role="slider"],[role="tablist"]') !== null;
}

/**
 * Pan the canvas with the arrow keys, for mice without a trackpad or middle
 * button. Hold a key to keep panning; Shift pans faster. Pressing Right
 * reveals what lies to the right, like scrolling. Zoom is unchanged.
 */
export function useArrowKeyPan(): void {
  const isActive = useIsActivePane();
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    if (!isActive) return;
    const held = new Set<string>();
    let fast = false;
    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      raf = 0;
      if (held.size === 0) return;
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      let dx = 0;
      let dy = 0;
      for (const key of held) {
        dx += ARROWS[key][0];
        dy += ARROWS[key][1];
      }
      const step = PAN_SPEED * (fast ? FAST_MULTIPLIER : 1) * dt;
      if (dx !== 0 || dy !== 0) {
        const v = getViewport();
        // Moving the view right means the content moves left.
        void setViewport({ x: v.x - dx * step, y: v.y - dy * step, zoom: v.zoom });
      }
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      held.clear();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.key in ARROWS)) return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ownsArrows(e.target)) return;
      e.preventDefault();
      fast = e.shiftKey;
      held.add(e.key);
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      fast = e.shiftKey;
      held.delete(e.key);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [isActive, getViewport, setViewport]);
}
