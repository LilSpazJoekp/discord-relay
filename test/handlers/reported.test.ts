import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {getPostById: vi.fn(), getCommentById: vi.fn()},
    settings: {get: vi.fn()},
}));
vi.mock("../../src/server/services/destinations.js", () => ({getDestinations: vi.fn(), isBucketEnabled: vi.fn()}));
vi.mock("../../src/server/services/relay.js", () => ({relayToDestinations: vi.fn()}));

import {reddit, settings} from "@devvit/web/server";
import {handleReportedTrigger} from "../../src/server/handlers/reported.js";
import {getDestinations, isBucketEnabled} from "../../src/server/services/destinations.js";
import {relayToDestinations} from "../../src/server/services/relay.js";
import type {RelayDestination} from "../../src/server/types.js";
import {makeComment, makePost} from "../helpers/items.js";

const destinations: RelayDestination[] = [{
    id: "destination-1", webhookUrl: "https://discord.com/api/webhooks/123/token", events: ["reported"],
}];
let settingValues: Record<string, unknown>;

function reportEvent(overrides: Record<string, unknown> = {}) {
    return {type: "PostReport", post: {id: "post1"}, ...overrides} as Parameters<typeof handleReportedTrigger>[0];
}

describe("reported content triggers", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => {});
        settingValues = {"reported-minimum-report-count": 2};
        vi.mocked(settings.get).mockImplementation(async (name) => settingValues[name] as never);
        vi.mocked(isBucketEnabled).mockResolvedValue(true);
        vi.mocked(getDestinations).mockResolvedValue(destinations);
        vi.mocked(reddit.getPostById).mockResolvedValue(makePost({numberOfReports: 2, userReportReasons: ["Spam"]}));
        vi.mocked(reddit.getCommentById).mockResolvedValue(makeComment({numReports: 2, userReportReasons: ["Spam"]}));
    });

    afterEach(() => vi.restoreAllMocks());

    it("relays a qualifying post report with report details", async () => {
        await handleReportedTrigger(reportEvent({reason: "Off topic", reporter: "moderator1"}));

        expect(reddit.getPostById).toHaveBeenCalledExactlyOnceWith("t3_post1");
        expect(getDestinations).toHaveBeenCalledWith("reported", "post");
        expect(relayToDestinations).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            bucket: "reported", destinations, itemType: "post", uniqueId: "t3_post1",
            message: expect.objectContaining({embed: expect.objectContaining({
                title: "New Report",
                fields: expect.arrayContaining([
                    {name: "Report body", value: "Off topic"},
                    {name: "Report count", value: "2"},
                    {name: "Reporter", value: "moderator1"},
                ]),
            })}),
        }));
    });

    it.each([
        {type: "CommentReport", comment: {id: "comment1"}},
        {type: "CommentReport", commentId: "t1_comment1"},
    ])("supports comment IDs in $type payloads: %j", async (payload) => {
        await handleReportedTrigger(reportEvent(payload));

        expect(reddit.getCommentById).toHaveBeenCalledExactlyOnceWith("t1_comment1");
        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(getDestinations).toHaveBeenCalledWith("reported", "comment");
        expect(relayToDestinations).toHaveBeenCalledWith(expect.objectContaining({
            itemType: "comment", uniqueId: "t3_post1/t1_comment1",
        }));
    });

    it("supports a top-level post ID", async () => {
        await handleReportedTrigger(reportEvent({post: undefined, postId: "t3_post1"}));

        expect(reddit.getPostById).toHaveBeenCalledWith("t3_post1");
        expect(relayToDestinations).toHaveBeenCalledOnce();
    });

    it.each([
        {type: "all", mods: [], users: ["Spam"], count: 1, bypass: false, send: false},
        {type: "all", mods: [], users: ["Spam"], count: 2, bypass: false, send: true},
        {type: "mod-only", mods: [], users: ["Spam"], count: 3, bypass: false, send: false},
        {type: "mod-only", mods: ["Rule 1"], users: [], count: 2, bypass: false, send: true},
        {type: "user-only", mods: ["Rule 1"], users: [], count: 3, bypass: true, send: false},
        {type: "user-only", mods: [], users: ["Spam"], count: 2, bypass: false, send: true},
        {type: "all", mods: ["Rule 1"], users: [], count: 1, bypass: false, send: false},
        {type: "all", mods: ["Rule 1"], users: [], count: 1, bypass: true, send: true},
        {type: "all", mods: [], users: ["Spam"], count: 1, bypass: true, send: false},
    ])("applies report type and count filters: %j", async ({type, mods, users, count, bypass, send}) => {
        settingValues["reported-report-type"] = type;
        settingValues["reported-mod-reports-bypass-minimum"] = bypass;
        vi.mocked(reddit.getPostById).mockResolvedValue(makePost({
            modReportReasons: mods, userReportReasons: users, numberOfReports: count,
        }));

        await handleReportedTrigger(reportEvent());

        expect(relayToDestinations).toHaveBeenCalledTimes(send ? 1 : 0);
        expect(getDestinations).toHaveBeenCalledTimes(send ? 1 : 0);
    });

    it("avoids Reddit lookups when reported relays are disabled", async () => {
        vi.mocked(isBucketEnabled).mockResolvedValue(false);

        await handleReportedTrigger(reportEvent());

        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(relayToDestinations).not.toHaveBeenCalled();
    });

    it.each(["PostReport", "CommentReport"])("ignores %s events without item IDs", async (type) => {
        await handleReportedTrigger(reportEvent({type, post: undefined}));

        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(reddit.getCommentById).not.toHaveBeenCalled();
        expect(relayToDestinations).not.toHaveBeenCalled();
    });

    it("skips qualifying reports when no destination matches", async () => {
        vi.mocked(getDestinations).mockResolvedValue([]);

        await handleReportedTrigger(reportEvent());

        expect(relayToDestinations).not.toHaveBeenCalled();
    });
});
