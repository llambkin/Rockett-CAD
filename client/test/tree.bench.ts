import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { ModelTree } from "../src/components/ModelTree";
import { useStore } from "../src/store";
import { manyBodyPayloads } from "./helpers/perfFixtures";
import { record, SAMPLES } from "../../server/test/helpers/perfFixtures";

const sync = { async: false };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("many-body", async ({ bench }) => {
  const bodies = manyBodyPayloads();
  const evaluation = () =>
    ({
      bodies: bodies.map((b) => ({ ...b })),
      planes: [],
      kernelMs: 0,
      featureStatuses: [],
      sketches: [],
    }) as any;
  useStore.setState({
    projectId: "p1",
    document: createEmptyDocument("p1", "Part"),
    evaluation: evaluation(),
    mode: { name: "idle" },
    selection: [],
    busy: false,
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(ModelTree)));
  record(
    "tree rerender many-body",
    await bench("tree rerender many-body", sync, () => {
      act(() => useStore.setState({ evaluation: evaluation() }));
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  let n = 0;
  record(
    "tree select many-body",
    await bench("tree select many-body", sync, () => {
      const bodyId = bodies[n++ % 2]!.bodyId;
      act(() => useStore.setState({ selection: [{ kind: "body", bodyId }] }));
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  act(() => root.unmount());
  host.remove();
});
