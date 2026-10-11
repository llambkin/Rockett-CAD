import { qrMatrix } from "../qr";
import { QR_COLOURS } from "../theme/tokens";

const QUIET_ZONE = 4;
const MODULE_PX = 4;

export function QrCode({ text, label }: { text: string; label: string }) {
  const matrix = qrMatrix(text);
  const side = matrix.length + 2 * QUIET_ZONE;
  const modules = matrix
    .flatMap((row, y) =>
      row.flatMap((dark, x) =>
        dark ? [`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`] : [],
      ),
    )
    .join("");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      width={side * MODULE_PX}
      height={side * MODULE_PX}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill={QR_COLOURS.light} />
      <path d={modules} fill={QR_COLOURS.dark} />
    </svg>
  );
}
