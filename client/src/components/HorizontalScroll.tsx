import type { ReactNode } from "react";
import { wheelPan } from "../three/wheel";

function scrollHorizontal(strip: HTMLDivElement) {
  const onWheel = (event: WheelEvent) => {
    if (
      !(event.target instanceof Node) ||
      !strip.contains(event.target) ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.shiftKey ||
      event.deltaX !== 0 ||
      event.deltaY === 0 ||
      strip.scrollWidth <= strip.clientWidth
    )
      return;
    event.preventDefault();
    strip.scrollLeft -= wheelPan(event)[1];
  };
  strip.ownerDocument.addEventListener("wheel", onWheel, { passive: false });
  return () => strip.ownerDocument.removeEventListener("wheel", onWheel);
}

export function HorizontalScroll({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      ref={scrollHorizontal}
      onWheel={(event) => {
        if (event.defaultPrevented) event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
