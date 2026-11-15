import { parseNaturalEventWindow } from "../event-window-parser.ts";

const inputs = JSON.parse(process.argv[2]);
console.log(
  JSON.stringify({
    serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    results: inputs.map((input) =>
      parseNaturalEventWindow({ ...input, now: new Date(input.now) }),
    ),
  }),
);
