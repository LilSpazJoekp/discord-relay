import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {getPostById: vi.fn(), getCommentById: vi.fn()},
    redis: {hSet: vi.fn()},
    settings: {get: vi.fn()},
}));
vi.mock("../../src/server/services/destinations.js", () => ({isBucketEnabled: vi.fn()}));
vi.mock("../../src/server/services/relay.js", () => ({scheduleRelay: vi.fn()}));
vi.mock("../../src/server/services/shouldRelay.js", () => ({shouldRelay: vi.fn()}));

import {reddit, redis, settings} from "@devvit/web/server";
import {handleContentTrigger} from "../../src/server/handlers/content.js";
import {isBucketEnabled} from "../../src/server/services/destinations.js";
import {scheduleRelay} from "../../src/server/services/relay.js";
import {shouldRelay} from "../../src/server/services/shouldRelay.js";
import type {ContentTriggerRequest} from "../../src/server/types.js";
import {makeComment, makePost} from "../helpers/items.js";

let settingValues: Record<string, unknown>;

function event(type: ContentTriggerRequest["type"], overrides: Record<string, unknown> = {}) {
    return {type, post: {id: "post1"}, comment: {id: "comment1"}, ...overrides} as ContentTriggerRequest;
}

describe("content triggers", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => {});
        settingValues = {};
        vi.mocked(settings.get).mockImplementation(async (name) => settingValues[name] as never);
        vi.mocked(isBucketEnabled).mockResolvedValue(true);
        vi.mocked(shouldRelay).mockResolvedValue(true);
        vi.mocked(reddit.getPostById).mockResolvedValue(makePost());
        vi.mocked(reddit.getCommentById).mockResolvedValue(makeComment());
    });

    afterEach(() => vi.restoreAllMocks());

    it.each([
        ["PostCreate", false, true],
        ["CommentCreate", false, true],
        ["PostSubmit", false, false],
        ["CommentSubmit", false, false],
        ["PostCreate", true, false],
        ["CommentCreate", true, false],
        ["PostSubmit", true, true],
        ["CommentSubmit", true, true],
    ] as const)("handles %s with skip-safety-checks=%s only when eligible=%s", async (type, skipSafety, eligible) => {
        settingValues["skip-safety-checks"] = skipSafety;

        await handleContentTrigger(event(type));

        expect(scheduleRelay).toHaveBeenCalledTimes(eligible ? 1 : 0);
        expect(shouldRelay).toHaveBeenCalledTimes(eligible ? 1 : 0);
        if (!eligible) {
            expect(reddit.getPostById).not.toHaveBeenCalled();
            expect(reddit.getCommentById).not.toHaveBeenCalled();
        }
    });

    it("preserves event author and flair information for post filtering", async () => {
        const item = makePost();
        vi.mocked(reddit.getPostById).mockResolvedValue(item);
        const authorFlair = {text: "Event user flair", templateId: "event-user"};
        const postFlair = {text: "Event post flair", templateId: "event-post"};

        await handleContentTrigger(event("PostCreate", {
            author: {name: "bob", flair: authorFlair},
            post: {id: "post1", linkFlair: postFlair},
        }));

        expect(reddit.getPostById).toHaveBeenCalledExactlyOnceWith("t3_post1");
        expect(shouldRelay).toHaveBeenCalledWith({item, itemType: "post", authorName: "bob", authorFlair, postFlair});
        expect(redis.hSet).toHaveBeenCalledWith(item.id, {shouldRelay: "true"});
        expect(scheduleRelay).toHaveBeenCalledWith(item, false);
    });

    it("falls back to fetched post author and flair fields", async () => {
        const item = makePost();
        vi.mocked(reddit.getPostById).mockResolvedValue(item);

        await handleContentTrigger(event("PostCreate"));

        expect(shouldRelay).toHaveBeenCalledWith({
            item, itemType: "post", authorName: "alice", authorFlair: item.authorFlair, postFlair: item.flair,
        });
    });

    it("loads comments and excludes post flair from comment filtering", async () => {
        const item = makeComment();
        vi.mocked(reddit.getCommentById).mockResolvedValue(item);

        await handleContentTrigger(event("CommentCreate", {post: {id: "post1", linkFlair: {text: "News"}}}));

        expect(reddit.getCommentById).toHaveBeenCalledExactlyOnceWith("t1_comment1");
        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(shouldRelay).toHaveBeenCalledWith({
            item, itemType: "comment", authorName: "alice", authorFlair: item.authorFlair, postFlair: undefined,
        });
    });

    it("records rejected content so approval retries will not relay it", async () => {
        vi.mocked(shouldRelay).mockResolvedValue(false);

        await handleContentTrigger(event("PostCreate"));

        expect(redis.hSet).toHaveBeenCalledWith("t3_post1", {shouldRelay: "false"});
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it("does not fetch content when the unmoderated bucket is disabled", async () => {
        vi.mocked(isBucketEnabled).mockResolvedValue(false);

        await handleContentTrigger(event("PostCreate"));

        expect(settings.get).not.toHaveBeenCalled();
        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it("leaves front-page mode content to the scheduled scan", async () => {
        settingValues["relay-mode"] = "front-page";

        await handleContentTrigger(event("PostCreate"));

        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it.each(["PostCreate", "CommentCreate"] as const)("ignores %s events without an item ID", async (type) => {
        await handleContentTrigger(event(type, {post: {}, comment: {}}));

        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(reddit.getCommentById).not.toHaveBeenCalled();
        expect(redis.hSet).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it("propagates lookup failures without recording an eligibility decision", async () => {
        vi.mocked(reddit.getPostById).mockRejectedValue(new Error("Post unavailable"));

        await expect(handleContentTrigger(event("PostCreate"))).rejects.toThrow("Post unavailable");
        expect(redis.hSet).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });
});
