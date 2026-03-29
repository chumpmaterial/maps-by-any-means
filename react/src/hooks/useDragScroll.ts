import { useRef, useEffect } from 'react';

/**
 * Enables click-and-drag horizontal panning on an overflow-x-auto container.
 * Apply `ref` to the element, `onMouseDown` to start tracking, and
 * `onClickCapture` to suppress child clicks after a drag occurs.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const state = useRef({ isDown: false, startX: 0, scrollLeft: 0, didDrag: false });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!state.current.isDown || !ref.current) return;
      const dx = e.pageX - state.current.startX;
      if (Math.abs(dx) > 3) state.current.didDrag = true;
      ref.current.scrollLeft = state.current.scrollLeft - dx;
    };

    const handleMouseUp = () => {
      if (!state.current.isDown || !ref.current) return;
      state.current.isDown = false;
      ref.current.style.cursor = '';
      ref.current.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent<T>) => {
    if (!ref.current) return;
    state.current = {
      isDown: true,
      startX: e.pageX,
      scrollLeft: ref.current.scrollLeft,
      didDrag: false,
    };
    ref.current.style.cursor = 'grabbing';
    ref.current.style.userSelect = 'none';
  };

  // Suppress child button clicks when the mousedown turned into a drag
  const onClickCapture = (e: React.MouseEvent) => {
    if (state.current.didDrag) {
      e.stopPropagation();
      e.preventDefault();
      state.current.didDrag = false;
    }
  };

  return { ref, onMouseDown, onClickCapture };
}
