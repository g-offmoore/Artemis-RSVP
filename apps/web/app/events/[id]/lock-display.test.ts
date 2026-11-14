import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { computeAssignmentLockScheduledFor } from "@artemis/domain";
import { describe, expect, it } from "vitest";

// Compile the real server page functions in isolation: Next preserves JSX,
// and normal imports would also load unrelated client panels.
const path = "apps/web/app/events/[id]/page.tsx";
const source = ts.createSourceFile(
  path,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functions = source.statements
  .filter(ts.isFunctionDeclaration)
  .map((node) => node.getText(source).replace("export default ", ""));
const code = ts.transpileModule(functions.join("\n"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
    jsx: ts.JsxEmit.React,
  },
}).outputText;

describe("web scheduled assignment lock display", () => {
  it.each([
    [undefined, "5:00 PM", undefined],
    [30, "5:30 PM", undefined],
    [120, "4:00 PM", undefined],
    [0, "6:00 PM", undefined],
    [30, "5:30 PM", "2027-08-01T16:15:00Z"],
  ])(
    "shows effective offset %s separately from actual lock %s (%s)",
    async (offset, expected, assignmentLockedAt) => {
      const panels = Object.fromEntries(
        [
          "Link",
          "AttendancePanel",
          "BackupDmPanel",
          "EditEventForm",
          "EligibilityRulesPanel",
          "EventManagement",
          "ParticipantsPanel",
          "SignupOptionsPanel",
        ].map((name) => [name, () => null]),
      );
      const event = {
        id: "evt",
        title: "Event",
        status: "SCHEDULED",
        startAt: "2027-08-01T18:00:00Z",
        endAt: "2027-08-01T22:00:00Z",
        assignmentLockOffsetMinutes: offset,
        assignmentLockedAt,
        participants: [],
        tables: [],
        assignments: [],
        auditLogs: [],
      };
      const page = await runInNewContext(
        `${code}\nEventPage({ params: Promise.resolve({ id: 'evt' }) })`,
        {
          ...panels,
          React,
          process: { env: {} },
          computeAssignmentLockScheduledFor,
          requireSession: async () => ({ activeGuildId: "guild" }),
          artemisApi: async (url: string) =>
            url.includes("guild-settings")
              ? { defaultTimezone: "UTC" }
              : url === "/api/v1/events/evt"
                ? event
                : [],
        },
      );
      const html = renderToStaticMarkup(page);
      expect(html).toContain("Assignment lock (scheduled)");
      expect(html).toContain(expected);
      if (assignmentLockedAt) {
        expect(html).toContain("Locked");
        expect(html).toContain("4:15 PM");
      }
    },
  );
});
