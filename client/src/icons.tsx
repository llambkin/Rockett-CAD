import type { ReactNode } from "react";

function svg(children: ReactNode) {
  return () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ICONS = {
  sketch: svg(
    <>
      <g opacity=".45">
        <path d="M2.75 21 6 15.5h15.25L18 21Z" />
      </g>
      <path d="M5 19h3" />
      <path d="M8 19l1.6-4.4 9-9 2.8 2.8-9 9Z" />
      <path d="M9.6 14.6l2.8 2.8" />
    </>,
  ),
  extrude: svg(
    <>
      <g opacity=".45">
        <path d="M3 12h11l5-4H8Z" />
        <path d="M3 20v-8M14 20v-8M19 16V8" />
      </g>
      <path d="M3 20h11l5-4H8Z" />
      <path d="M11 18V3.5M8.5 6 11 3.5 13.5 6" />
    </>,
  ),
  revolve: svg(
    <>
      <g opacity=".45">
        <path d="M12 2.5v19" strokeDasharray="2 2.5" />
        <path d="M4.5 16a7.5 3.5 0 0 1 15 0" />
      </g>
      <path d="M14 3.5h5.5V12H14Z" />
      <path d="M19.5 16a7.5 3.5 0 0 1-15 0" />
      <path d="M2.5 18.5 4.5 16l2 2.5" />
    </>,
  ),
  sweep: svg(
    <>
      <g opacity=".45">
        <ellipse cx="18" cy="6" rx="1.75" ry="3.25" />
        <path d="M6 14.75c6 0 4-12 12-12M6 21.25c8 0 6-12 12-12" />
      </g>
      <ellipse cx="6" cy="18" rx="1.75" ry="3.25" />
      <path d="M6 18c7 0 5-12 12-12" />
    </>,
  ),
  loft: svg(
    <>
      <g opacity=".45">
        <path d="M4 20 7 6M20 16 17 6" />
      </g>
      <path d="M4 20h11l5-4H9Z" />
      <ellipse cx="12" cy="6" rx="5" ry="2" />
    </>,
  ),
  emboss: svg(
    <>
      <path d="M2.75 18 7 14h14.25L17 18Z" />
      <path d="M2.75 18v3H17v-3M17 21l4.25-4v-3" />
      <path d="M7 12c1.7-2.5 3.3-2.5 5 0s3.3 2.5 5 0" />
      <g opacity=".45">
        <path d="M7 12v4M17 12v4" />
      </g>
    </>,
  ),
  fillet: svg(
    <>
      <g opacity=".45">
        <path d="M4 12V5h7" />
      </g>
      <path d="M4 21v-9a7 7 0 0 1 7-7h9" />
    </>,
  ),
  chamfer: svg(
    <>
      <g opacity=".45">
        <path d="M4 12V5h7" />
      </g>
      <path d="M4 21v-9l7-7h9" />
    </>,
  ),
  shell: svg(
    <>
      <path d="M3 5v16h18V5h-4v12H7V5Z" />
    </>,
  ),
  combine: svg(
    <>
      <g opacity=".45">
        <path d="M9 9h4v5.66M9 9a6 6 0 0 0 4 5.66" />
      </g>
      <path d="M9 9H3v11h10v-5.34A6 6 0 1 0 9 9Z" />
    </>,
  ),
  splitBody: svg(
    <>
      <g opacity=".45">
        <path d="M12 2.5v19" strokeDasharray="2 2.5" />
      </g>
      <path d="M3 6h6.5v12H3ZM14.5 6H21v12h-6.5Z" />
    </>,
  ),
  offsetFace: svg(
    <>
      <path d="M3 14h12v7H3Z" />
      <path d="M3 14l5-4h12l-5 4M15 21l5-4v-7" />
      <path d="M11.5 2.5V10M9 5l2.5-2.5L14 5M9 7.5l2.5 2.5L14 7.5" />
    </>,
  ),
  move: svg(
    <>
      <path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5" />
    </>,
  ),
  constructionPlane: svg(
    <>
      <g opacity=".45">
        <path d="M2.75 20.5 7 14h14.25L17 20.5Z" />
      </g>
      <path d="M2.75 12 7 5.5h14.25L17 12Z" />
    </>,
  ),
  mirror: svg(
    <>
      <g opacity=".45">
        <path d="M12 2.5v19" strokeDasharray="2 2.5" />
        <path d="M14.5 6 21 18h-6.5Z" />
      </g>
      <path d="M9.5 6 3 18h6.5Z" />
    </>,
  ),
  linearPattern: svg(
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <g opacity=".45">
        <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
        <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
        <rect x="14" y="14" width="6.5" height="6.5" rx="1" />
      </g>
    </>,
  ),
  circularPattern: svg(
    <>
      <circle cx="12" cy="4.5" r="2.25" />
      <g opacity=".45">
        <circle cx="18.5" cy="8.25" r="2.25" />
        <circle cx="18.5" cy="15.75" r="2.25" />
        <circle cx="12" cy="19.5" r="2.25" />
        <circle cx="5.5" cy="15.75" r="2.25" />
        <circle cx="5.5" cy="8.25" r="2.25" />
      </g>
      <circle cx="12" cy="12" r="0.75" fill="currentColor" />
    </>,
  ),
  measure: svg(
    <>
      <g transform="rotate(-45 12 12)">
        <rect x="2" y="8.5" width="20" height="7" rx="1" />
        <path d="M5 8.5v3M8.5 8.5v2M12 8.5v4M15.5 8.5v2M19 8.5v3" />
      </g>
    </>,
  ),
  importStep: svg(
    <>
      <path d="M3 15v4.5A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V15" />
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
    </>,
  ),
  referenceImage: svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="M3 17l5.5-5.5 4.5 4.5 2.5-2.5 5.5 5.5" />
      <circle cx="16" cy="9" r="1.5" />
    </>,
  ),
  export: svg(
    <>
      <path d="M3 15v4.5A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V15" />
      <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
    </>,
  ),
  fit: svg(
    <>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
    </>,
  ),
  projection: svg(
    <>
      <g opacity=".45">
        <path d="M10 4v9h9M10 13l-7 8" />
      </g>
      <path d="M3 9h12v12H3Z" />
      <path d="M3 9l7-5h9v9l-4 8M15 9l4-5" />
    </>,
  ),
  select: svg(
    <>
      <path d="M5 3v16l4-3.8 2.6 5.8 2.3-1-2.6-5.7h5.3Z" />
    </>,
  ),
  line: svg(
    <>
      <path d="M6.25 17.75 17.75 6.25" />
      <circle cx="5" cy="19" r="1.75" />
      <circle cx="19" cy="5" r="1.75" />
    </>,
  ),
  rect: svg(
    <>
      <rect x="4" y="6" width="16" height="12" rx=".5" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
      <circle cx="20" cy="6" r="1" fill="currentColor" />
    </>,
  ),
  centerRect: svg(
    <>
      <rect x="4" y="6" width="16" height="12" rx=".5" />
      <g opacity=".45">
        <path d="M12 12l8-6" />
      </g>
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="20" cy="6" r="1" fill="currentColor" />
    </>,
  ),
  circle: svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <g opacity=".45">
        <path d="M12 12h8.5" />
      </g>
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>,
  ),
  arc3: svg(
    <>
      <path d="M4 18a8.2 8.2 0 1 1 16 0" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
      <circle cx="20" cy="18" r="1" fill="currentColor" />
    </>,
  ),
  polygon: svg(
    <>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9Z" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>,
  ),
  slot: svg(
    <>
      <path d="M8 8h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8Z" />
      <g opacity=".45">
        <path d="M8 12h8" />
      </g>
      <circle cx="8" cy="12" r="0.75" fill="currentColor" />
      <circle cx="16" cy="12" r="0.75" fill="currentColor" />
    </>,
  ),
  point: svg(
    <>
      <g opacity=".45">
        <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
      </g>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>,
  ),
  dimension: svg(
    <>
      <g opacity=".45">
        <path d="M5 17V6M19 17V6" />
      </g>
      <path d="M5 9h14M8 6.5 5 9l3 2.5M16 6.5l3 2.5-3 2.5" />
      <path d="M5 19.5h14" />
    </>,
  ),
  project: svg(
    <>
      <g opacity=".45">
        <path d="M2.75 21 6 16h15.25L18 21Z" />
        <path d="M7 4h10" />
      </g>
      <path d="M12 6.5v8M9.5 12l2.5 2.5 2.5-2.5" />
      <path d="M7.5 18.5h9" />
    </>,
  ),
  trim: svg(
    <>
      <path d="M7 3v18M17 3v18M3 12h4M17 12h4" />
      <g opacity=".45">
        <path d="M7 12h10" strokeDasharray="2 2.5" />
      </g>
    </>,
  ),
  extend: svg(
    <>
      <path d="M19.5 3v18M4 12h7" />
      <g opacity=".45">
        <path d="M11 12h8.5" strokeDasharray="2 2.5" />
      </g>
      <path d="M16.5 9.5 19 12l-2.5 2.5" />
    </>,
  ),
  offset: svg(
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="2" />
      <g opacity=".45">
        <rect x="3" y="3" width="18" height="18" rx="5" />
      </g>
    </>,
  ),
  construction: svg(
    <>
      <path d="M6.25 17.75 17.75 6.25" strokeDasharray="1.5 3" />
      <circle cx="5" cy="19" r="1.75" />
      <circle cx="19" cy="5" r="1.75" />
    </>,
  ),
  delete: svg(
    <>
      <path d="M4 6.5h16M9.5 6.5v-2h5v2M6 6.5l1 14h10l1-14M10 10v7M14 10v7" />
    </>,
  ),
  finishSketch: svg(
    <>
      <path d="M4.5 12.5l5 5 10-11" />
    </>,
  ),
  horizontal: svg(
    <>
      <path d="M4 12h16" />
      <circle cx="4" cy="12" r="1.25" fill="currentColor" />
      <circle cx="20" cy="12" r="1.25" fill="currentColor" />
    </>,
  ),
  vertical: svg(
    <>
      <path d="M12 4v16" />
      <circle cx="12" cy="4" r="1.25" fill="currentColor" />
      <circle cx="12" cy="20" r="1.25" fill="currentColor" />
    </>,
  ),
  coincident: svg(
    <>
      <g opacity=".45">
        <path d="M4 20l5.2-5.2M20 19l-4.9-4.3" />
      </g>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>,
  ),
  parallel: svg(
    <>
      <path d="M4 15l9-9M11 18l9-9" />
    </>,
  ),
  perpendicular: svg(
    <>
      <g opacity=".45">
        <path d="M12 16h4v4" />
      </g>
      <path d="M4 20h16M12 20V4" />
    </>,
  ),
  tangent: svg(
    <>
      <circle cx="12" cy="14.5" r="6" />
      <path d="M3 8.5h18" />
      <circle cx="12" cy="8.5" r="1" fill="currentColor" />
    </>,
  ),
  equal: svg(
    <>
      <path d="M4 8h16M4 16h16M11 10l2-4M11 18l2-4" />
    </>,
  ),
  concentric: svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" />
    </>,
  ),
  midpoint: svg(
    <>
      <path d="M4 18 20 6M7.1 13.8l1.8 2.4M15.1 7.8l1.8 2.4" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>,
  ),
  collinear: svg(
    <>
      <path d="M4 20l5-5M15 9l5-5" />
      <g opacity=".45">
        <path d="M9 15l6-6" strokeDasharray="0 2.5" />
      </g>
    </>,
  ),
  browser: svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="M3 8.5h18M6 6.5h.01M8.5 6.5h.01" />
    </>,
  ),
  fix: svg(
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
    </>,
  ),
};

export type IconId = keyof typeof ICONS;
