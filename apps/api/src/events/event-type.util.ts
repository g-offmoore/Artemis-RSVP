import { randomUUID } from "node:crypto";
import type { EventTypeOverrides } from "@artemis/domain";
import type { PrismaService } from "../prisma/prisma.service.js";

export type PrismaTx = Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0];
type EventTypeWriter = Pick<PrismaTx, "eventType">;

/**
 * Always inserts a fresh EventType row — never upserts/shares by key. Each event
 * and each series gets its own independently-editable copy of signup behavior
 * (rules.md's "profiles store defaults, events store decisions", applied to
 * event-type config too). `key` is now an opaque internal identifier only,
 * never a lookup/reuse key; `name` is the organizer-facing label.
 */
export async function createEventType(
  db: EventTypeWriter,
  guildId: string,
  overrides: EventTypeOverrides,
  gameSystem: string,
) {
  return db.eventType.create({
    data: {
      guildId,
      key: `evt-${randomUUID()}`,
      name: overrides.name ?? "D&D Session Night",
      requiresRsvp: overrides.requiresRsvp,
      allowsGuests: overrides.allowsGuests,
      maxGuestsPerRsvp: overrides.maxGuestsPerRsvp,
      requiresAmbassadors: overrides.requiresAmbassadors,
      requiresTableAssignment: overrides.requiresTableAssignment,
      usesPlayerCategories: overrides.usesPlayerCategories,
      createsTemporaryRoles: overrides.createsTemporaryRoles,
      requiresAttendanceConfirmation: overrides.requiresAttendanceConfirmation,
      sendsFeedbackPrompts: overrides.sendsFeedbackPrompts,
      usesWaitlist: overrides.usesWaitlist,
      allowsNameOnlyWalkIns: overrides.allowsNameOnlyWalkIns,
      defaultGameSystem: gameSystem,
    },
  });
}

/**
 * Copy-on-write guard for editing an owner's EventType via PATCH. Data created
 * before per-event overrides existed may still have several events/series
 * pointing at the same shared row (the old upsert-by-key model). If more than
 * one owner currently references this row, clone it and repoint the given
 * owner first, so the patch can never silently mutate a sibling event/series
 * or the series template.
 */
export async function resolveOwnedEventType(
  tx: PrismaTx,
  eventTypeId: string,
  owner: { kind: "event"; id: string } | { kind: "series"; id: string },
) {
  const [eventCount, seriesCount] = await Promise.all([
    tx.event.count({ where: { eventTypeId } }),
    tx.eventSeries.count({ where: { eventTypeId } }),
  ]);

  const source = await tx.eventType.findUniqueOrThrow({ where: { id: eventTypeId } });
  if (eventCount + seriesCount <= 1) {
    return source;
  }

  const clone = await createEventType(tx, source.guildId, source, source.defaultGameSystem);
  if (owner.kind === "event") {
    await tx.event.update({ where: { id: owner.id }, data: { eventTypeId: clone.id } });
  } else {
    await tx.eventSeries.update({ where: { id: owner.id }, data: { eventTypeId: clone.id } });
  }
  return clone;
}
