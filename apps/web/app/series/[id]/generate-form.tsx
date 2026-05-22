"use client";

import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";
import { ActionState, generateOccurrencesAction } from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

export function GenerateOccurrencesForm({ seriesId }: { seriesId: string }) {
  const [state, formAction, pending] = useActionState(generateOccurrencesAction, initialState);

  return (
    <form className="form-grid compact" action={formAction}>
      <input type="hidden" name="seriesId" value={seriesId} />
      <label>
        Occurrences to generate
        <input name="count" type="number" min={1} max={12} defaultValue={4} required />
      </label>
      <div className="form-actions span-all">
        <button className="button" type="submit" disabled={pending}>
          <CalendarPlus size={16} />
          {pending ? "Generating" : "Generate occurrences"}
        </button>
        {state.message ? (
          <p className={state.ok ? "form-message ok" : "form-message error"}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
