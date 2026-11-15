/** Calendar components in an explicit zone; never the process-local timezone. */
export function formatUtcAsTimeZoneParts(date: Date, timeZone: string) {
  return createTimeZonePartsReader(timeZone)(date);
}

/** Reuse one Intl formatter for bounded candidate searches. */
export function createTimeZonePartsReader(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (date: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  };
}
