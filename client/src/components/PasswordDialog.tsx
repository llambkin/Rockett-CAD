import { useState } from "react";
import { api, ApiError } from "../api";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api.changePassword(current, next);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? failure.retryAfter
            ? `Too many attempts. Try again in ${failure.retryAfter} seconds.`
            : "Too many attempts. Try again later."
          : failure instanceof ApiError && failure.status === 403
            ? "Incorrect current password."
            : failure instanceof ApiError && failure.status === 400
              ? "Password must be 12 to 256 characters."
              : failure instanceof Error
                ? failure.message
                : "Could not change password.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel id="dialog.password" title="Change password">
      <div className="dialog-body">
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <p>Use 12 to 256 characters.</p>
      </div>
      <DialogFooter
        onOk={() => void submit()}
        onCancel={onClose}
        okLabel="Change password"
        pending={pending}
        okDisabled={!current || !next}
      />
    </DraggablePanel>
  );
}
