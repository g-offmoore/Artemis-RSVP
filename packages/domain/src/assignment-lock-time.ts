// Dependency-free canonical lock policy, shared by validation and presentation.
// Keep this module independent of index.ts (which re-exports presentation).
export const DEFAULT_ASSIGNMENT_LOCK_OFFSET_MINUTES = 60;

export function isAssignmentLockOffsetMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2147483647
  );
}

// Elapsed whole minutes before the absolute start instant. Only omission defaults;
// zero and explicit legacy/custom offsets remain authoritative.
export function computeAssignmentLockScheduledFor(
  startAt: Date,
  offsetMinutes = DEFAULT_ASSIGNMENT_LOCK_OFFSET_MINUTES,
): Date {
  if (!isAssignmentLockOffsetMinutes(offsetMinutes)) {
    throw new RangeError("Invalid assignment lock offset minutes");
  }
  const lockAt = new Date(startAt.getTime() - offsetMinutes * 60 * 1000);
  if (!Number.isFinite(lockAt.getTime())) {
    throw new RangeError("Invalid assignment lock time");
  }
  return lockAt;
}
