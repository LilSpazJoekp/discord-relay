import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    redis: {hSetNX: vi.fn(), hGet: vi.fn(), hSet: vi.fn(), hDel: vi.fn()},
    scheduler: {runJob: vi.fn()},
    settings: {get: vi.fn()},
}));

vi.mock("../../src/server/services/destinations.js", () => ({getDestinations: vi.fn()}));

import {redis, scheduler, settings} from "@devvit/web/server";

import {getDestinations} from "../../src/server/services/destinations.js";
import {relayToDestinations, relayWebhook, scheduleRelay} from "../../src/server/services/relay.js";
import type {RelayDestination} from "../../src/server/types.js";
import {makeComment, makePost} from "../helpers/items.js";

const discord: RelayDestination = {
    id: "destination-1",
    webhookUrl: "https://discord.com/api/webhooks/123/token",
    events: ["all"],
};
const slack: RelayDestination = {
    id: "destination-2",
    webhookUrl: "https://hooks.slack.com/services/T/B/C",
    events: ["all"],
};
const fetchMock = vi.fn<typeof fetch>();
let settingValues: Record<string, unknown>;

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T13:00:00Z"));
    vi.stubGlobal("fetch", fetchMock);
    settingValues = {};
    vi.mocked(settings.get).mockImplementation(async (name) => settingValues[name] as never);
    vi.mocked(redis.hSetNX).mockResolvedValue(1);
    vi.mocked(getDestinations).mockResolvedValue([discord, slack]);
    fetchMock.mockImplementation(async () => new Response(null, {status: 204}));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("webhook delivery", () => {
    it("sends a JSON payload after claiming the relay and retains the claim on success", async () => {
        await relayWebhook("relay:reported:destination-1:t3_post1", discord.webhookUrl, {content: "A report"});

        expect(redis.hSetNX).toHaveBeenCalledWith("relay:reported:destination-1:t3_post1", "relayed", "true");
        expect(fetchMock).toHaveBeenCalledWith(discord.webhookUrl, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({content: "A report", allowed_mentions: {parse: ["roles", "users", "everyone"]}}),
        });
        expect(redis.hDel).not.toHaveBeenCalled();
    });

    it("sends only once when two workers try to claim the same event", async () => {
        vi.mocked(redis.hSetNX).mockResolvedValueOnce(1).mockResolvedValueOnce(0);

        await Promise.all([
            relayWebhook("same-event", discord.webhookUrl, {content: "Hello"}),
            relayWebhook("same-event", discord.webhookUrl, {content: "Hello"}),
        ]);

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("releases the claim after a network failure so delivery can be retried", async () => {
        const failure = new Error("Connection reset");
        fetchMock.mockRejectedValueOnce(failure);

        await expect(relayWebhook("retry-event", discord.webhookUrl, {content: "Hello"})).rejects.toBe(failure);
        expect(redis.hDel).toHaveBeenCalledWith("retry-event", ["relayed"]);

        await relayWebhook("retry-event", discord.webhookUrl, {content: "Hello"});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not send if claiming the event fails", async () => {
        vi.mocked(redis.hSetNX).mockRejectedValue(new Error("Redis unavailable"));

        await expect(relayWebhook("event", discord.webhookUrl, {})).rejects.toThrow("Redis unavailable");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("relay fan-out", () => {
    it("formats each destination payload and records separate bucket and item receipts", async () => {
        const item = makePost();
        await relayToDestinations({
            bucket: "reported", destinations: [discord, slack], item, itemType: "post",
            uniqueId: item.id, message: {content: "See [post](https://www.reddit.com/comments/post1)"},
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
            content: "See [post](https://www.reddit.com/comments/post1)",
        });
        expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({
            text: "See <https://www.reddit.com/comments/post1|post>",
        });
        for (const destination of [discord, slack]) {
            expect(redis.hSetNX).toHaveBeenCalledWith(`relay:reported:${destination.id}:t3_post1`, "relayed", "true");
            expect(redis.hSet).toHaveBeenCalledWith(item.id, {[`reported:${destination.id}:relayed`]: "true"});
            expect(redis.hSet).toHaveBeenCalledWith(item.id, {[`post:${destination.id}:relayed`]: "true"});
        }
    });

    it("sends events without a Reddit item without writing item receipts", async () => {
        await relayToDestinations({
            bucket: "modmail", destinations: [discord], uniqueId: "message1", message: {content: "Modmail"},
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(redis.hSet).not.toHaveBeenCalled();
    });

    it("writes only the bucket receipt when the item type is omitted", async () => {
        await relayToDestinations({
            bucket: "reported", destinations: [discord], item: makePost(), uniqueId: "t3_post1", message: {},
        });

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("t3_post1", {"reported:destination-1:relayed": "true"});
    });

    it("skips removed items when removal filtering is enabled", async () => {
        settingValues["ignore-removed"] = true;

        await relayToDestinations({
            bucket: "reported", destinations: [discord, slack], item: makePost({removed: true}),
            itemType: "post", uniqueId: "t3_post1", message: {},
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(redis.hSet).not.toHaveBeenCalled();
    });

    it("does not record a successful item relay after a delivery failure", async () => {
        fetchMock.mockRejectedValue(new Error("Network down"));

        await expect(relayToDestinations({
            bucket: "reported", destinations: [discord], item: makePost(), itemType: "post",
            uniqueId: "t3_post1", message: {},
        })).rejects.toThrow("Network down");

        expect(redis.hSet).not.toHaveBeenCalled();
    });
});

describe("unmoderated relay scheduling", () => {
    it("immediately relays a post with its author and permalink", async () => {
        await scheduleRelay(makePost(), false);

        expect(getDestinations).toHaveBeenCalledWith("unmoderated", "post");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).content).toBe(
            "New [post](https://www.reddit.com/r/test/comments/post1/title/) by [u/alice](https://www.reddit.com/user/alice)!",
        );
        expect(scheduler.runJob).not.toHaveBeenCalled();
    });

    it("schedules a comment approval retry with fallback author links, embed flags, and a role ping", async () => {
        settingValues = {
            "comment-delay": 3,
            "comment-delay-after-approval": 5,
            "suppress-author-embed": true,
            "suppress-item-embed": true,
            "ping-role": true,
            "ping-role-id": "123456",
        };
        const item = makeComment();

        await scheduleRelay(item, true);

        expect(getDestinations).toHaveBeenCalledWith("unmoderated", "comment");
        expect(scheduler.runJob).toHaveBeenCalledTimes(2);
        for (const destination of [discord, slack]) {
            const trackingKey = `relay:unmoderated:${destination.id}:t3_post1/t1_comment1`;
            expect(scheduler.runJob).toHaveBeenCalledWith({
                name: "relay",
                data: {
                    bucket: "unmoderated",
                    destinationId: destination.id,
                    itemType: "comment",
                    itemId: item.id,
                    message: {
                        content: "New [comment](<https://www.reddit.com/r/test/comments/post1/title/comment1/>) by [u/alice](<https://www.reddit.com/user/alice>)!\n<@&123456>",
                    },
                    trackingKey,
                    uniqueId: "t3_post1/t1_comment1",
                    webhookUrl: destination.webhookUrl,
                },
                runAt: new Date("2026-09-17T13:05:00Z"),
            });
            expect(redis.hSet).toHaveBeenCalledWith(trackingKey, {scheduled: "true"});
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("schedules only destinations without a pending job", async () => {
        settingValues["post-delay"] = 3;
        vi.mocked(redis.hGet).mockImplementation(async (key) => key.includes(discord.id) ? "true" : undefined);

        await scheduleRelay(makePost(), false);

        expect(scheduler.runJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            data: expect.objectContaining({destinationId: slack.id}),
            runAt: new Date("2026-09-17T13:03:00Z"),
        }));
        expect(redis.hSet).toHaveBeenCalledOnce();
    });

    it("leaves scheduling retryable when the scheduler fails", async () => {
        settingValues["post-delay"] = 3;
        vi.mocked(getDestinations).mockResolvedValue([discord]);
        vi.mocked(scheduler.runJob).mockRejectedValue(new Error("Scheduler unavailable"));

        await expect(scheduleRelay(makePost(), false)).rejects.toThrow("Scheduler unavailable");
        expect(redis.hSet).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does nothing when no destination matches", async () => {
        vi.mocked(getDestinations).mockResolvedValue([]);

        await scheduleRelay(makePost(), false);

        expect(scheduler.runJob).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        {ignoreRemoved: true, removed: true, deliveries: 0},
        {ignoreRemoved: true, removed: false, deliveries: 2},
        {ignoreRemoved: false, removed: true, deliveries: 2},
    ])("sends $deliveries webhooks when ignore-removed=$ignoreRemoved and removed=$removed", async ({ignoreRemoved, removed, deliveries}) => {
        settingValues["ignore-removed"] = ignoreRemoved;

        await scheduleRelay(makePost({removed}), false);

        expect(fetchMock).toHaveBeenCalledTimes(deliveries);
        expect(scheduler.runJob).not.toHaveBeenCalled();
    });
});
