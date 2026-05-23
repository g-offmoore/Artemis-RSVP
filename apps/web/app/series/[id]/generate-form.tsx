"use client";

import { useActionState, useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { ActionState, generateOccurrencesAction } from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

export function GenerateOccurrencesForm({ seriesId }: { seriesId: string }) {
  const [state, formAction, pending] = useActionState(
    generateOccurrencesAction,
    initialState,
  );
  const [count, setCount] = useState(4);
  const validationError = useMemo(() => {
    if (!Number.isInteger(count)) return "Use a whole number of events.";
    if (count < 1) return "Generate at least 1 event.";
    if (count > 52) return "Maximum is 52 events at a time.";
    return "";
  }, [count]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    if (validationError) {
      event.preventDefault();
      return;
    }
    const confirmMessage = `Generate the next ${count} event${count === 1 ? "" : "s"} for this series?`;
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  };

  return (
    <form
      className="form-grid compact"
      action={formAction}
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="seriesId" value={seriesId} />
      <label>
        Generate next N events
        <input
          name="count"
          type="number"
          min={1}
          max={52}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          required
        />
      </label>
      <div className="form-actions span-all">
        <button
          className="button"
          type="submit"
          disabled={pending || Boolean(validationError)}
        >
          <CalendarPlus size={16} />
          {pending ? "Generating" : "Generate occurrences"}
        </button>
        {validationError ? (
          <p className="form-message error">{validationError}</p>
        ) : null}
        {state.message ? (
          <p className={state.ok ? "form-message ok" : "form-message error"}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
