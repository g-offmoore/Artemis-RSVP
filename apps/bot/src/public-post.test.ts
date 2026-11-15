import { describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { refreshPublicPost, resolvePublicPostTarget } from "./public-post.js";

const ephemeralFlags = { has: (f: number) => f === MessageFlags.Ephemeral };
const publicFlags = { has: () => false };

describe("resolvePublicPostTarget", () => {
  it("prefers the persisted canonical channel/message of the event", () => {
    expect(
      resolvePublicPostTarget(
        { channelId: "chanA", messageId: "msgA" },
        {
          hintedMessageId: "hint",
          channelId: "chanB",
          sourceIsEphemeral: true,
          interactionMessage: {
            id: "eph",
            channelId: "chanB",
            flags: ephemeralFlags,
          },
        },
      ),
    ).toEqual({ channelId: "chanA", messageId: "msgA" });
  });

  it("falls back to the public post id carried by the panel buttons", () => {
    expect(
      resolvePublicPostTarget(
        { channelId: "chanA", messageId: null },
        {
          hintedMessageId: "hint",
          channelId: "chanB",
          sourceIsEphemeral: true,
        },
      ),
    ).toEqual({ channelId: "chanB", messageId: "hint" });
  });

  it("falls back to a legacy public-button click's own (non-ephemeral) message", () => {
    expect(
      resolvePublicPostTarget(
        { channelId: "chanA", messageId: null },
        {
          channelId: "chanB",
          sourceIsEphemeral: false,
          interactionMessage: {
            id: "pub",
            channelId: "chanB",
            flags: publicFlags,
          },
        },
      ),
    ).toEqual({ channelId: "chanB", messageId: "pub" });
  });

  it("NEVER targets an ephemeral interaction message", () => {
    for (const source of [
      {
        channelId: "chanB",
        sourceIsEphemeral: true,
        interactionMessage: {
          id: "eph",
          channelId: "chanB",
          flags: ephemeralFlags,
        },
      },
      {
        channelId: "chanB",
        sourceIsEphemeral: false,
        interactionMessage: {
          id: "eph",
          channelId: "chanB",
          flags: ephemeralFlags,
        },
      },
    ]) {
      expect(
        resolvePublicPostTarget(
          { channelId: "chanA", messageId: null },
          source,
        ),
      ).toBeNull();
    }
  });

  it("returns null when nothing identifies the public post", () => {
    expect(resolvePublicPostTarget({}, { sourceIsEphemeral: true })).toBeNull();
  });
});

describe("refreshPublicPost", () => {
  const event = {
    id: "evt1",
    channelId: "chanA",
    messageId: "msgA",
    title: "Game Night",
  };

  it("edits the canonical public message with the rebuilt post", async () => {
    const edit = vi.fn(async () => undefined);
    const fetchMessage = vi.fn(async () => ({ edit }));
    await refreshPublicPost(
      {
        getEvent: async () => event,
        fetchMessage,
        render: (e) => ({ embeds: [e.title], components: ["row"] }),
        warn: vi.fn(),
      },
      "evt1",
      {
        sourceIsEphemeral: true,
        channelId: "chanB",
        interactionMessage: { id: "eph", flags: ephemeralFlags },
      },
    );
    expect(fetchMessage).toHaveBeenCalledWith("chanA", "msgA");
    expect(edit).toHaveBeenCalledWith({
      embeds: ["Game Night"],
      components: ["row"],
    });
  });

  it("does nothing (and does not edit anything) when the post cannot be identified", async () => {
    const fetchMessage = vi.fn();
    await refreshPublicPost(
      {
        getEvent: async () => ({ ...event, messageId: null }),
        fetchMessage,
        render: () => ({}),
        warn: vi.fn(),
      },
      "evt1",
      { sourceIsEphemeral: true },
    );
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it("swallows Discord/API failures and logs a warning", async () => {
    const warn = vi.fn();
    await expect(
      refreshPublicPost(
        {
          getEvent: async () => event,
          fetchMessage: async () => {
            throw new Error("Unknown Message");
          },
          render: () => ({}),
          warn,
        },
        "evt1",
        { sourceIsEphemeral: true },
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("handles a message that no longer exists", async () => {
    const warn = vi.fn();
    await refreshPublicPost(
      {
        getEvent: async () => event,
        fetchMessage: async () => null,
        render: () => ({}),
        warn,
      },
      "evt1",
      { sourceIsEphemeral: true },
    );
    expect(warn).toHaveBeenCalled();
  });
});
