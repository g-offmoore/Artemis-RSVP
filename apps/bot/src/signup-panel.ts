// Renderers for the ephemeral personal signup panel. Pure: they turn the
// participant-safe MySignupView (see @artemis/domain my-signup) into message
// text and button descriptors. The view already decided what is allowed; this
// module only decides wording and layout, and never invents seat guarantees.
import { ActionRowBuilder, ButtonBuilder } from "discord.js";
import type {
  ClosedReason,
  EventButtonDescriptor,
  MySignupView,
  SeatView,
} from "@artemis/domain";
import { buildPanelCustomId, type PanelAction } from "./custom-ids.js";

export type PanelMessage = {
  content: string;
  rows: EventButtonDescriptor[][];
};

type PanelOptions = {
  /** Result of the live eligibility pre-check for backup availability. */
  backupEligible?: boolean;
  /** Public post message id carried in IDs so the post can be refreshed. */
  postMessageId?: string;
  /** One-line result of the action that just ran. */
  notice?: string;
};

const CLOSED_COPY: Record<ClosedReason, string> = {
  CANCELLED: "This event has been cancelled.",
  ENDED: "This event has ended, so signups can no longer be changed.",
  IN_PROGRESS: "This event has started, so signups can no longer be changed.",
  NOT_PUBLISHED: "This event is not open for signup.",
  LOCKED:
    "Signups and assignments are locked. Guests, preferences and table changes now need an organizer.",
  SIGNUP_CLOSED: "Signup is closed for this event.",
  NOT_OPEN_YET: "Signup has not opened yet for this event.",
};

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

function categoryLabel(view: MySignupView, category?: string) {
  return (
    view.event.categories.find((c) => c.value === category)?.label ??
    (category ? titleCase(category) : undefined)
  );
}

function seatLine(seat: SeatView): string {
  switch (seat.code) {
    case "CONFIRMED_SEAT": {
      const table = seat.table;
      if (!table) return "";
      const gm = table.gmName ? ` — run by ${table.gmName}` : "";
      return `**Confirmed seat:** ${table.title} (${titleCase(table.tableType)})${gm}.`;
    }
    case "CONFIRMED_WAITLIST":
      return "You are on the **waitlist** and do not currently have a confirmed seat.";
    case "TENTATIVE_SEAT":
      return "Current outlook: there appears to be room for you, but this is **not confirmed** and can change until assignments are confirmed.";
    case "TENTATIVE_WAITLIST":
      return "Current outlook: you are on the waitlist for now. This is **not final** and can change as tables and signups change.";
    case "REGISTERED":
      return "Seating has not been decided yet. Check back here after assignments are confirmed.";
    default:
      return "";
  }
}

function guestSeatText(seat: SeatView): string {
  switch (seat.code) {
    case "CONFIRMED_SEAT":
      return seat.table ? `seated at ${seat.table.title}` : "registered";
    case "CONFIRMED_WAITLIST":
      return "waitlisted";
    case "TENTATIVE_SEAT":
      return "registered (seat not confirmed)";
    case "TENTATIVE_WAITLIST":
      return "waitlist for now (not final)";
    default:
      return "registered";
  }
}

const button = (
  customId: string,
  label: string,
  style: EventButtonDescriptor["style"],
): EventButtonDescriptor => ({ customId, label, style });

function panelId(
  action: PanelAction,
  view: MySignupView,
  actorId: string,
  options: { category?: string; postMessageId?: string } = {},
) {
  return buildPanelCustomId(action, view.eventId, actorId, options);
}

function notePrefix(notice?: string) {
  return notice ? `${notice}\n\n` : "";
}

export function buildSignupPanel(
  view: MySignupView,
  actorId: string,
  options: PanelOptions = {},
): PanelMessage {
  const { participation, actions, event } = view;
  const host = event.hostLabel;
  const lines: string[] = [`**${event.title}** — your signup`, ""];

  switch (participation.state) {
    case "PLAYER": {
      const cat = event.usesDndCategories
        ? ` (${categoryLabel(view, participation.category) ?? "Normal"})`
        : "";
      lines.push(`You're signed up as a player${cat}.`);
      const seat = seatLine(view.seat);
      if (seat) lines.push(seat);
      if (participation.backup === "AVAILABLE") {
        lines.push(
          "",
          `Backup ${host} availability: **on**. You keep your player signup. If a ${host} is needed and you're selected, you'll be asked before anything changes.`,
        );
      } else if (participation.backup === "NOT_AVAILABLE") {
        lines.push("", `Backup ${host} availability: off.`);
      }
      if (event.allowsGuests && event.maxGuests > 0) {
        lines.push(
          "",
          `**Guests (${view.guests.length}/${event.maxGuests}):**`,
        );
        if (view.guests.length === 0) lines.push("None added.");
        for (const g of view.guests) {
          lines.push(`• ${g.displayName} — ${guestSeatText(g.seat)}`);
        }
      }
      break;
    }
    case "GM": {
      lines.push(`You're running a table as a ${host}.`);
      for (const t of view.tables) {
        lines.push(
          `• ${t.title} (${titleCase(t.tableType)}, ${t.softCap}/${t.hardCap} seats)`,
        );
      }
      lines.push(
        "Organizers handle table rosters and seating. To withdraw or cancel a table, contact an organizer.",
      );
      break;
    }
    case "CANCELLED":
      lines.push("Your signup was cancelled. You are not currently signed up.");
      break;
    case "REMOVED":
      lines.push(
        "Your signup is not active. Contact an organizer if you think this is a mistake.",
      );
      break;
    default:
      lines.push("You're not signed up yet.");
  }

  if (event.closedReason) lines.push("", CLOSED_COPY[event.closedReason]);

  const row: EventButtonDescriptor[] = [];
  if (actions.join) row.push(button(`join:${view.eventId}`, "Join", 3));
  if (actions.runTable)
    row.push(button(`run_table:${view.eventId}`, "Run a table", 1));
  if (actions.editGuests)
    row.push(button(`guest:${view.eventId}`, "Guests", 2));
  if (actions.editPreferences) {
    row.push(button(`prefs:${view.eventId}`, "Preferences", 2));
  }
  if (actions.addBackup && options.backupEligible !== false) {
    row.push(
      button(
        panelId("backup", view, actorId, {
          postMessageId: options.postMessageId,
        }),
        `Add backup ${host} availability`,
        1,
      ),
    );
  }
  if (actions.editTable)
    row.push(button(`host:${view.eventId}`, "Edit table", 1));
  if (actions.cancel) {
    row.push(
      button(
        panelId("cancel", view, actorId, {
          postMessageId: options.postMessageId,
        }),
        "Cancel signup",
        4,
      ),
    );
  }
  const live =
    (participation.state === "PLAYER" || participation.state === "GM") &&
    !(
      event.closedReason === "CANCELLED" ||
      event.closedReason === "ENDED" ||
      event.closedReason === "IN_PROGRESS" ||
      event.closedReason === "NOT_PUBLISHED"
    );
  if (live) {
    row.push(
      button(
        panelId("refresh", view, actorId, {
          postMessageId: options.postMessageId,
        }),
        "Refresh",
        2,
      ),
    );
  }

  return {
    content: notePrefix(options.notice) + lines.join("\n"),
    rows: row.length ? [row] : [],
  };
}

export function buildJoinChoice(
  view: MySignupView,
  actorId: string,
  options: { postMessageId?: string; notice?: string } = {},
): PanelMessage {
  const single = view.event.categories.length === 1;
  const buttons = view.event.categories.map((c, index) =>
    button(
      panelId("pick", view, actorId, {
        category: c.value,
        postMessageId: options.postMessageId,
      }),
      single ? "Join" : `Join as ${c.label}`,
      index === 0 ? 3 : 1,
    ),
  );
  return {
    content:
      notePrefix(options.notice) +
      `**${view.event.title}**\n` +
      (single
        ? "Ready to join? Press **Join** to sign up."
        : "How would you like to join?") +
      "\nYou can add guests, preferences and backup availability afterward from **My signup**.",
    rows: [buttons],
  };
}

export function buildCancelConfirm(
  view: MySignupView,
  actorId: string,
  options: { postMessageId?: string } = {},
): PanelMessage {
  const n = view.guests.length;
  const guestLine =
    n > 0 ? ` This also removes your ${n} guest${n === 1 ? "" : "s"}.` : "";
  return {
    content: `Cancel your signup for **${view.event.title}**?${guestLine} You can sign up again later if signup is still open.`,
    rows: [
      [
        button(
          panelId("cancel_yes", view, actorId, options),
          "Yes, cancel my signup",
          4,
        ),
        button(panelId("keep", view, actorId, options), "Keep my signup", 2),
      ],
    ],
  };
}

export function buildRunTableMessage(view: MySignupView): PanelMessage {
  const { participation, actions, event } = view;
  const host = event.hostLabel;
  const head = `**${event.title}**\n`;

  if (event.closedReason && !actions.editTable) {
    return { content: head + CLOSED_COPY[event.closedReason], rows: [] };
  }
  if (participation.state === "GM") {
    return actions.editTable
      ? {
          content: `${head}You're already running a table. You can update its details.`,
          rows: [[button(`host:${view.eventId}`, "Edit table", 1)]],
        }
      : {
          content: `${head}You're already running a table. Table changes now need an organizer.`,
          rows: [],
        };
  }
  if (participation.state === "PLAYER") {
    return {
      content:
        `${head}You're signed up as a player, and a player can't also run a table. ` +
        `To run a table instead, first cancel your player signup from **My signup** ` +
        `(this also removes any guests you added), then use **Run a table** again.`,
      rows: [[button(`my_signup:${view.eventId}`, "My signup", 2)]],
    };
  }
  if (participation.state === "REMOVED") {
    return {
      content: `${head}Your signup is not active. Contact an organizer if you think this is a mistake.`,
      rows: [],
    };
  }
  return {
    content:
      `${head}Open the form to set up your table. Your table size and any ` +
      `eligibility rules are checked when you submit; organizers confirm seating.`,
    rows: [[button(`host:${view.eventId}`, `Open ${host} form`, 1)]],
  };
}

export function toDiscordRows(
  rows: EventButtonDescriptor[][],
): ActionRowBuilder<ButtonBuilder>[] {
  return rows.map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...row.map((b) =>
        new ButtonBuilder()
          .setCustomId(b.customId)
          .setLabel(b.label)
          .setStyle(b.style),
      ),
    ),
  );
}
