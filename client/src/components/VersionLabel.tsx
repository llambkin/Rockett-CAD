import { useEffect, useState } from "react";
import { api } from "../api";
import { versionLabel } from "../versionLabel";

export function VersionLabel() {
  const [label, setLabel] = useState<ReturnType<typeof versionLabel>>();
  useEffect(() => {
    api
      .health()
      .then((h) => setLabel(versionLabel(h)))
      .catch(() => setLabel(undefined));
  }, []);
  if (!label) return null;
  return (
    <div className="version-label" title={label.title}>
      {label.text}
    </div>
  );
}
