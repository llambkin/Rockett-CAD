import { useEffect, useRef } from "react";
import { create } from "zustand";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";

type Point = { x: number; y: number };

type Ask = {
  id: number;
  message: string;
  at: Point | undefined;
  okLabel: string | undefined;
  answer: (yes: boolean) => void;
};

const asked = create<{ ask: Ask | null }>(() => ({ ask: null }));

let asks = 0;

export function confirm(
  message: string,
  at?: Point,
  okLabel?: string,
): Promise<boolean> {
  asked.getState().ask?.answer(false);
  return new Promise((resolve) => {
    const ask: Ask = {
      id: ++asks,
      message,
      at,
      okLabel,
      answer: (yes) => {
        if (asked.getState().ask === ask) asked.setState({ ask: null });
        resolve(yes);
      },
    };
    asked.setState({ ask });
  });
}

export function ConfirmPanel() {
  const ask = asked((s) => s.ask);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.parentElement
      ?.querySelector<HTMLButtonElement>(".btn.primary")
      ?.focus();
  }, [ask]);
  if (!ask) return null;
  return (
    <DraggablePanel
      key={ask.id}
      id="dialog.confirm"
      title="Confirm"
      {...(ask.at && { at: ask.at })}
    >
      <div className="dialog-body" ref={body}>
        <p>{ask.message}</p>
      </div>
      <DialogFooter
        escapeAnywhere
        {...(ask.okLabel && { okLabel: ask.okLabel })}
        onOk={() => ask.answer(true)}
        onCancel={() => ask.answer(false)}
      />
    </DraggablePanel>
  );
}
