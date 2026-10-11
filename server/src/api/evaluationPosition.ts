import { ValidationError, type CadDocument } from "@rockett/shared";

export function evaluationPosition(
  req: any,
  doc: CadDocument,
): number | undefined {
  if (req.query.position === undefined) return undefined;
  const position = Number(req.query.position);
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > doc.features.length
  )
    throw new ValidationError("invalid evaluation position");
  return position;
}
