import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {getPostById: vi.fn(), getCommentById: vi.fn(), getCurrentSubreddit: vi.fn()},
    redis: {hSet: vi.fn()},
    settings: {get: vi.fn()},
}));
vi.mock("../../src/server/services/relay.js", () => ({relayWebhook: vi.fn(), scheduleRelay: vi.fn()}));
vi.mock("../../src/server/services/shouldRelay.js", () => ({shouldRelay: vi.fn()}));
vi.mock("../../src/server/services/modqueue.js", () => ({scanModqueue: vi.fn()}));

import {reddit, redis, settings} from "@devvit/web/server";
import {schedulerRouter} from "../../src/server/routes/scheduler.js";
import {scanModqueue} from "../../src/server/services/modqueue.js";
import {relayWebhook, scheduleRelay} from "../../src/server/services/relay.js";
import {shouldRelay} from "../../src/server/services/shouldRelay.js";
import {makeComment, makePost} from "../helpers/items.js";

let settingValues: Record<string, unknown>;
const job = {
    itemId: "post1",
    itemType: "post",
    uniqueId: "t3_post1",
    trackingKey: "relay:unmoderated:destination-1:t3_post1",
    webhookUrl: "https://discord.com/api/webhooks/123/token",
    message: {content: "Scheduled post"},
};

function postJob(name: string, body: unknown = {}) {
    return schedulerRouter.request(`/internal/scheduler/${name}`, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    settingValues = {};
    vi.mocked(settings.get).mockImplementation(async (name) => settingValues[name] as never);
    vi.mocked(reddit.getPostById).mockResolvedValue(makePost());
    vi.mocked(reddit.getCommentById).mockResolvedValue(makeComment());
});

afterEach(() => vi.restoreAllMocks());

describe("scheduled relay route", () => {
    it.each([{}, {data: {...job, message: undefined}}])("rejects incomplete jobs before looking up content: %j", async (body) => {
        const response = await postJob("relay", body);

        expect(response.status).toBe(400);
        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(reddit.getCommentById).not.toHaveBeenCalled();
        expect(relayWebhook).not.toHaveBeenCalled();
    });

    it("delivers the scheduled message using its destination-specific tracking key", async () => {
        const response = await postJob("relay", {data: job});

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({});
        expect(reddit.getPostById).toHaveBeenCalledWith("t3_post1");
        expect(relayWebhook).toHaveBeenCalledWith(job.trackingKey, job.webhookUrl, job.message);
    });

    it("supports legacy comment jobs with nested data and no tracking key", async () => {
        const response = await postJob("relay", {data: {
            ...job, message: undefined, data: {content: "Legacy comment"}, trackingKey: undefined,
            itemId: "comment1", itemType: "comment", uniqueId: "t3_post1/t1_comment1",
        }});

        expect(response.status).toBe(200);
        expect(reddit.getCommentById).toHaveBeenCalledWith("t1_comment1");
        expect(relayWebhook).toHaveBeenCalledWith(
            "relay:unmoderated:legacy-webhook-url:t3_post1/t1_comment1", job.webhookUrl, {content: "Legacy comment"},
        );
    });

    it("prefers the current message when a legacy payload is also present", async () => {
        await postJob("relay", {data: {...job, data: {content: "Old payload"}}});

        expect(relayWebhook).toHaveBeenCalledWith(job.trackingKey, job.webhookUrl, job.message);
    });

    it.each([
        {ignoreRemoved: true, removed: true, deliveries: 0},
        {ignoreRemoved: true, removed: false, deliveries: 1},
        {ignoreRemoved: false, removed: true, deliveries: 1},
    ])("checks removal at execution time: %j", async ({ignoreRemoved, removed, deliveries}) => {
        settingValues["ignore-removed"] = ignoreRemoved;
        vi.mocked(reddit.getPostById).mockResolvedValue(makePost({removed}));

        const response = await postJob("relay", {data: job});

        expect(response.status).toBe(200);
        expect(relayWebhook).toHaveBeenCalledTimes(deliveries);
    });

    it("returns an error if delivery fails", async () => {
        vi.mocked(relayWebhook).mockRejectedValue(new Error("Webhook unavailable"));

        const response = await postJob("relay", {data: job});

        expect(response.status).toBe(500);
    });
});

describe("front-page scan route", () => {
    it("does not fetch top posts in immediate relay mode", async () => {
        const response = await postJob("check-front-page");

        expect(response.status).toBe(200);
        expect(reddit.getCurrentSubreddit).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it("checks all returned posts, saves eligibility, and schedules only eligible posts", async () => {
        settingValues["relay-mode"] = "front-page";
        const eligible = makePost();
        const rejected = makePost({id: "t3_post2"});
        const getTopPosts = vi.fn().mockReturnValue({all: vi.fn().mockResolvedValue([eligible, rejected])});
        vi.mocked(reddit.getCurrentSubreddit).mockResolvedValue({getTopPosts} as never);
        vi.mocked(shouldRelay).mockImplementation(async ({item}) => item.id === eligible.id);

        const response = await postJob("check-front-page");

        expect(response.status).toBe(200);
        expect(getTopPosts).toHaveBeenCalledWith({limit: 100});
        expect(shouldRelay).toHaveBeenCalledTimes(2);
        expect(shouldRelay).toHaveBeenCalledWith({
            item: eligible, itemType: "post", authorName: eligible.authorName,
            authorFlair: eligible.authorFlair, postFlair: eligible.flair,
        });
        expect(redis.hSet).toHaveBeenCalledWith(eligible.id, {shouldRelay: "true"});
        expect(redis.hSet).toHaveBeenCalledWith(rejected.id, {shouldRelay: "false"});
        expect(scheduleRelay).toHaveBeenCalledExactlyOnceWith(eligible, false);
    });
});

describe("modqueue scan route", () => {
    it("runs the scan and acknowledges the job", async () => {
        const response = await postJob("scan-modqueue");

        expect(response.status).toBe(200);
        expect(scanModqueue).toHaveBeenCalledOnce();
        expect(console.error).not.toHaveBeenCalled();
    });

    it.each([new Error("Reddit unavailable"), "Reddit unavailable"])("logs scan failures and still acknowledges the recurring job: %s", async (failure) => {
        vi.mocked(scanModqueue).mockRejectedValue(failure);

        const response = await postJob("scan-modqueue");

        expect(response.status).toBe(200);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Modqueue scan failed;"));
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Reddit unavailable"));
    });
});
