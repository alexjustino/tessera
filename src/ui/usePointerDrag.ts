import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** How far a press has to travel before it is a drag and not a click. */
const THRESHOLD_PX = 4;

export interface DragPoint {
  x: number;
  y: number;
}

export interface DragHandlers {
  /** The pointer moved, once it has become a drag. */
  onMove: (point: DragPoint) => void;
  /** Let go. Only called for a real drag: a press that stayed put is a click. */
  onDrop: (point: DragPoint) => void;
  /** Escape, or the page went away. */
  onCancel: () => void;
}

/**
 * Dragging with the pointer, the one way this product does it.
 *
 * Not HTML5 drag and drop: with Tauri's `dragDropEnabled` on, Windows hands every
 * native drag to the host and the page never hears of it. So the calendar could not
 * be dragged at all from 1.0 until a person tried, and synthetic events in a test hid
 * it. Pointer events reach the page, can be driven by a real input in the suite, and
 * let the screen show where a thing will land while it is carried.
 *
 * A control inside the dragged thing opts out with `data-no-drag`. The click that
 * ends a drag is swallowed, so letting go over a button does not press it.
 */
export function usePointerDrag() {
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );

  return useCallback((event: ReactPointerEvent<Element>, handlers: DragHandlers) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('[data-no-drag]') !== null) return;

    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;

    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('select-none');
      cleanup.current = null;
    };

    const onMove = (moved: PointerEvent) => {
      const point = { x: moved.clientX, y: moved.clientY };
      if (!dragging) {
        if (Math.hypot(point.x - start.x, point.y - start.y) < THRESHOLD_PX) return;
        dragging = true;
        document.body.classList.add('select-none');
      }
      handlers.onMove(point);
    };

    /** The click a let-go makes is not a press. None comes if it was let go elsewhere. */
    const swallowNextClick = () => {
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    };

    const onUp = (ended: PointerEvent) => {
      stop();
      if (!dragging) return;
      swallowNextClick();
      handlers.onDrop({ x: ended.clientX, y: ended.clientY });
    };

    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      key.preventDefault();
      key.stopPropagation();
      stop();
      if (!dragging) return;
      // Still held: letting go after this must not press what is under the pointer.
      window.addEventListener('pointerup', swallowNextClick, { capture: true, once: true });
      handlers.onCancel();
    };

    cleanup.current?.();
    cleanup.current = () => {
      stop();
      if (dragging) handlers.onCancel();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  }, []);
}
