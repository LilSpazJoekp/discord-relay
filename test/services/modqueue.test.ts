import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {
        getCurrentSubreddit: vi.fn(),
    },
    redis: {
        hGet: vi.fn(),
        hSet: vi.fn(),
    },
    settings: {
        get: vi.fn(),
    },
}));

vi.mock("../../src/server/services/destinations.js", () => ({
    getDestinations: vi.fn(),
    isBucketEnabled: vi.fn(),
}));

vi.mock("../../src/server/services/relay.js", () => ({
    relayToDestinations: vi.fn(),
}));

import {reddit, redis, settings} from "@devvit/web/server";

import {getDestinations, isBucketEnabled} from "../../src/server/services/destinations.js";
import {scanModqueue} from "../../src/server/services/modqueue.js";
import {relayToDestinations} from "../../src/server/services/relay.js";
import {makeComment, makePost} from "../helpers/items.js";

const getCurrentSubreddit = vi.mocked(reddit.getCurrentSubreddit);
const getRedisValue = vi.mocked(redis.hGet);
const setRedisValues = vi.mocked(redis.hSet);
const getSetting = vi.mocked(settings.get);
const getConfiguredDestinations = vi.mocked(getDestinations);
const getBucketEnabled = vi.mocked(isBucketEnabled);
const relay = vi.mocked(relayToDestinations);
const getModQueue = vi.fn();
const getAllItems = vi.fn();
const getItems = vi.fn();
let settingValues: Record<string, unknown>;

describe("modqueue scanner", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-17T13:00:00Z"));
        getCurrentSubreddit.mockReset();
        getRedisValue.mockReset();
        setRedisValues.mockReset();
        getSetting.mockReset();
        getConfiguredDestinations.mockReset();
        getBucketEnabled.mockReset();
        relay.mockReset();
        getModQueue.mockReset();
        getAllItems.mockReset();
        getItems.mockReset();

        getCurrentSubreddit.mockResolvedValue({getModQueue} as never);
        getModQueue.mockReturnValue({all: getAllItems, get: getItems});
        getAllItems.mockResolvedValue([]);
        getBucketEnabled.mockResolvedValue(true);
        getConfiguredDestinations.mockResolvedValue([{
            id: "destination-1",
            webhookUrl: "https://discord.com/api/webhooks/123/token",
            events: ["modqueue"],
        }]);
        getRedisValue.mockResolvedValue(undefined);
        settingValues = {"modqueue-content-type": "all"};
        getSetting.mockImplementation(async (name) => settingValues[name] as never);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each(["all", "post", "comment"] as const)("loads the entire %s listing", async (contentType) => {
        getSetting.mockImplementation(async (name) => name === "modqueue-content-type" ? contentType : undefined);

        await scanModqueue();

        expect(getModQueue).toHaveBeenCalledWith({type: contentType});
        expect(getAllItems).toHaveBeenCalledOnce();
        expect(getItems).not.toHaveBeenCalled();
    });

    it("relays every eligible item beyond the old 25-item cap", async () => {
        const items = Array.from({length: 30}, (_, index) => ({
            id: `post-${index}`,
            permalink: `/r/test/comments/post-${index}`,
            createdAt: "2026-08-31T12:00:00.000Z",
            numberOfReports: 0,
            userReportReasons: [],
            modReportReasons: [],
            title: `Post ${index}`,
            body: "",
        }));
        getAllItems.mockResolvedValue(items);

        await scanModqueue();

        expect(relay).toHaveBeenCalledTimes(items.length);
        expect(setRedisValues).toHaveBeenCalledTimes(items.length);
    });

    it.each(["bucket disabled", "no destinations"])("does not fetch the modqueue when %s", async (reason) => {
        if (reason === "bucket disabled") {
            getBucketEnabled.mockResolvedValue(false);
        } else {
            getConfiguredDestinations.mockResolvedValue([]);
        }

        await scanModqueue();

        expect(getCurrentSubreddit).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it.each([
        {key: "modqueue-minimum-report-count", value: 3},
        {key: "modqueue-only-mod-reported", value: true},
        {key: "modqueue-minimum-age-minutes", value: 61},
        {key: "modqueue-maximum-age-minutes", value: 59},
        {key: "modqueue-report-contains", value: "harassment"},
        {key: "modqueue-content-contains", value: "missing keyword"},
    ])("rejects items failing $key without marking them seen", async ({key, value}) => {
        settingValues[key] = value;
        getAllItems.mockResolvedValue([makePost({numberOfReports: 2, userReportReasons: ["Spam"]})]);

        await scanModqueue();

        expect(relay).not.toHaveBeenCalled();
        expect(setRedisValues).not.toHaveBeenCalled();
    });

    it.each([
        {item: "post", content: {title: "Important ALERT", body: "Ordinary text"}},
        {item: "comment", content: {body: "Important ALERT"}},
    ])("accepts a $item satisfying all filters, including exact age and report-count boundaries", async ({item, content}) => {
        settingValues = {
            "modqueue-minimum-report-count": 2,
            "modqueue-only-mod-reported": true,
            "modqueue-minimum-age-minutes": 60,
            "modqueue-maximum-age-minutes": 60,
            "modqueue-report-contains": "harassment, SPAM",
            "modqueue-content-contains": "missing, alert",
        };
        const properties = {...content, modReportReasons: ["Spam"], userReportReasons: ["Other report"]};
        const target = item === "post"
            ? makePost({...properties, numberOfReports: 2})
            : makeComment({...properties, numReports: 2});
        getAllItems.mockResolvedValue([target]);

        await scanModqueue();

        const uniqueId = item === "post" ? "t3_post1" : "t3_post1/t1_comment1";
        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            bucket: "modqueue", item: target, itemType: item, uniqueId,
        }));
        expect(setRedisValues).toHaveBeenCalledExactlyOnceWith(`modqueue:seen:${uniqueId}`, {seen: "true"});
    });

    it("does not relay an item already seen in an earlier scan", async () => {
        getAllItems.mockResolvedValue([makeComment()]);
        getRedisValue.mockResolvedValue("true");

        await scanModqueue();

        expect(getRedisValue).toHaveBeenCalledWith("modqueue:seen:t3_post1/t1_comment1", "seen");
        expect(relay).not.toHaveBeenCalled();
        expect(setRedisValues).not.toHaveBeenCalled();
    });

    it("routes posts and comments only to matching destination event types", async () => {
        const destinations = ["all", "post", "comment"].map((event) => ({
            id: event, events: [event], webhookUrl: `https://example.com/${event}`,
        }));
        getConfiguredDestinations.mockResolvedValue(destinations as never);
        getAllItems.mockResolvedValue([makePost(), makeComment()]);

        await scanModqueue();

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            itemType: "post", destinations: [destinations[0], destinations[1]],
        }));
        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            itemType: "comment", destinations: [destinations[0], destinations[2]],
        }));
    });

    it("does not mark an item seen when all destinations filter it out", async () => {
        getConfiguredDestinations.mockResolvedValue([{
            id: "comments", events: ["comment"], webhookUrl: "https://example.com/comments",
        }]);
        getAllItems.mockResolvedValue([makePost()]);

        await scanModqueue();

        expect(relay).not.toHaveBeenCalled();
        expect(setRedisValues).not.toHaveBeenCalled();
    });

    it("leaves a failed delivery unseen so the next scan can retry it", async () => {
        getAllItems.mockResolvedValue([makePost()]);
        relay.mockRejectedValue(new Error("Webhook unavailable"));

        await expect(scanModqueue()).rejects.toThrow("Webhook unavailable");
        expect(setRedisValues).not.toHaveBeenCalled();
    });
});
