import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {
        getCurrentSubreddit: vi.fn(),
        getUserById: vi.fn(),
    },
    redis: {
        hGet: vi.fn(),
    },
    settings: {
        get: vi.fn(),
    },
}));

import {reddit, redis, settings} from "@devvit/web/server";

import {shouldRelay} from "../../src/server/services/shouldRelay.js";
import type {FlairLike, ItemType} from "../../src/server/types.js";
import {makeComment, makePost} from "../helpers/items.js";

const getCurrentSubreddit = vi.mocked(reddit.getCurrentSubreddit);
const getUserById = vi.mocked(reddit.getUserById);
const getRedisValue = vi.mocked(redis.hGet);
const getSetting = vi.mocked(settings.get);
const getUserFlairTemplates = vi.fn();
const getPostFlairTemplates = vi.fn();
const getApprovedUsers = vi.fn();
const getModerators = vi.fn();

let settingValues: Record<string, unknown>;

describe("shouldRelay eligibility filters", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        getCurrentSubreddit.mockReset();
        getUserById.mockReset();
        getRedisValue.mockReset();
        getSetting.mockReset();
        getUserFlairTemplates.mockReset();
        getPostFlairTemplates.mockReset();
        getApprovedUsers.mockReset();
        getModerators.mockReset();

        settingValues = {"content-type": "all"};
        getSetting.mockImplementation(async (name) => settingValues[String(name)] as never);
        getRedisValue.mockResolvedValue(undefined);
        getUserFlairTemplates.mockResolvedValue([]);
        getPostFlairTemplates.mockResolvedValue([]);
        getApprovedUsers.mockReturnValue({all: vi.fn().mockResolvedValue([])});
        getModerators.mockReturnValue({all: vi.fn().mockResolvedValue([])});
        getCurrentSubreddit.mockResolvedValue({
            getApprovedUsers,
            getModerators,
            getPostFlairTemplates,
            getUserFlairTemplates,
        } as never);
    });

    afterEach(() => vi.restoreAllMocks());

    it("includes a comment by user flair template ID", async () => {
        settingValues["user-flair-template-id"] = "user-template-1, USER-TEMPLATE-2";

        await expect(checkItem({
            itemType: "comment",
            authorFlair: {text: "Different text", templateId: "user-template-2"},
        })).resolves.toBe(true);

        expect(getUserFlairTemplates).not.toHaveBeenCalled();
        expect(getPostFlairTemplates).not.toHaveBeenCalled();
    });

    it("matches post flair text or template ID when both are configured", async () => {
        settingValues["post-flair"] = "nonmatching text";
        settingValues["post-flair-template-id"] = "post-template-1";

        await expect(checkItem({
            itemType: "post",
            postFlair: {text: "Different text", templateId: "POST-TEMPLATE-1"},
        })).resolves.toBe(true);

        expect(getPostFlairTemplates).toHaveBeenCalledOnce();
    });

    it("lets a user flair template ID exclusion override an inclusion", async () => {
        settingValues["specific-username"] = "alice";
        settingValues["ignore-user-flair-template-id"] = "blocked-user-template";

        await expect(checkItem({
            itemType: "post",
            authorFlair: {templateId: "blocked-user-template"},
        })).resolves.toBe(false);
    });

    it("excludes a post by post flair template ID", async () => {
        settingValues["ignore-post-flair-template-id"] = "blocked-post-template";

        await expect(checkItem({
            itemType: "post",
            postFlair: {templateId: "blocked-post-template"},
        })).resolves.toBe(false);
    });

    it("does not apply post flair template ID filters to comments", async () => {
        settingValues["post-flair-template-id"] = "required-post-template";
        settingValues["ignore-post-flair-template-id"] = "blocked-post-template";

        await expect(checkItem({
            itemType: "comment",
            postFlair: {templateId: "blocked-post-template"},
        })).resolves.toBe(true);
    });

    it("preserves text matching through a flair template lookup", async () => {
        settingValues["user-flair"] = "trusted";
        getUserFlairTemplates.mockResolvedValue([{
            id: "user-template-1",
            text: "Trusted",
        }]);

        await expect(checkItem({
            itemType: "post",
            authorFlair: {templateId: "USER-TEMPLATE-1"},
        })).resolves.toBe(true);

        expect(getUserFlairTemplates).toHaveBeenCalledOnce();
    });

    it.each([
        {contentType: "post", itemType: "comment"},
        {contentType: "comment", itemType: "post"},
    ] as const)("rejects $itemType items when content-type is $contentType even if an inclusion matches", async ({contentType, itemType}) => {
        settingValues["content-type"] = contentType;
        settingValues["specific-username"] = "alice";

        await expect(checkItem({itemType})).resolves.toBe(false);
        expect(getRedisValue).not.toHaveBeenCalled();
    });

    it("rejects content previously marked as relayed", async () => {
        getRedisValue.mockResolvedValue("true");
        settingValues["specific-username"] = "alice";

        await expect(checkItem({itemType: "post"})).resolves.toBe(false);
        expect(getRedisValue).toHaveBeenCalledWith("t3_post1", "relayed");
    });

    it("rejects missing authors without requesting a user lookup", async () => {
        settingValues["ignore-shadowbanned"] = true;

        await expect(checkItem({itemType: "post", itemOverrides: {authorId: undefined}})).resolves.toBe(false);
        expect(getUserById).not.toHaveBeenCalled();
    });

    it.each([true, false])("requires a resolvable author when ignore-shadowbanned is enabled: found=%s", async (found) => {
        settingValues["ignore-shadowbanned"] = true;
        getUserById.mockResolvedValue(found ? {username: "alice"} as never : undefined);

        await expect(checkItem({itemType: "post"})).resolves.toBe(found);
        expect(getUserById).toHaveBeenCalledWith("t2_author1");
    });

    it.each([
        {users: [{username: "ALICE"}], allowed: true},
        {users: [{username: "bob"}], allowed: false},
        {users: [], allowed: false},
    ])("checks approved authors case-insensitively before inclusions: %j", async ({users, allowed}) => {
        settingValues["only-approved-users"] = true;
        settingValues["specific-username"] = "alice";
        getApprovedUsers.mockReturnValue({all: vi.fn().mockResolvedValue(users)});

        await expect(checkItem({itemType: "post"})).resolves.toBe(allowed);
        expect(getApprovedUsers).toHaveBeenCalledWith({username: "alice"});
    });

    it.each([
        {excluded: " bob, ALICE ", moderators: [], allowed: false},
        {excluded: "bob", moderators: [], allowed: true},
        {excluded: "m", moderators: [{username: "alice"}], allowed: false},
        {excluded: "m", moderators: [], allowed: true},
    ])("lets username and moderator exclusions override inclusions: %j", async ({excluded, moderators, allowed}) => {
        settingValues["specific-username"] = "alice";
        settingValues["ignore-specific-username"] = excluded;
        getModerators.mockReturnValue({all: vi.fn().mockResolvedValue(moderators)});

        await expect(checkItem({itemType: "post"})).resolves.toBe(allowed);
    });

    it.each([true, false])("includes moderators through the m filter only when membership matches: %s", async (isModerator) => {
        settingValues["specific-username"] = "bob, M";
        getModerators.mockReturnValue({all: vi.fn().mockResolvedValue(isModerator ? [{username: "alice"}] : [])});

        await expect(checkItem({itemType: "post"})).resolves.toBe(isModerator);
        expect(getModerators).toHaveBeenCalledWith({username: "alice"});
    });

    it.each([
        {key: "ignore-user-flair", authorFlair: {text: "Blocked"}, postFlair: undefined},
        {key: "ignore-post-flair", authorFlair: undefined, postFlair: {text: "Blocked"}},
    ])("excludes matching flair text using $key even with an included username", async ({key, authorFlair, postFlair}) => {
        settingValues[key] = "blocked";
        settingValues["specific-username"] = "alice";

        await expect(checkItem({itemType: "post", authorFlair, postFlair})).resolves.toBe(false);
    });

    it("matches post flair text through a template lookup", async () => {
        settingValues["post-flair"] = "news";
        getPostFlairTemplates.mockResolvedValue([{id: "post-template", text: "News"}]);

        await expect(checkItem({itemType: "post", postFlair: {templateId: "POST-TEMPLATE"}})).resolves.toBe(true);
    });

    it("accepts any matching inclusion and rejects items matching none", async () => {
        settingValues["specific-username"] = "bob";
        settingValues["user-flair"] = "trusted";
        settingValues["post-flair-template-id"] = "required-template";

        await expect(checkItem({itemType: "post", authorFlair: {text: "Trusted"}})).resolves.toBe(true);
        await expect(checkItem({itemType: "post", authorFlair: {text: "Untrusted"}})).resolves.toBe(false);
    });

    it.each([
        {score: 9, allowed: false},
        {score: 10, allowed: true},
        {score: 11, allowed: true},
    ])("applies the front-page score threshold at its boundary: %j", async ({score, allowed}) => {
        settingValues["relay-mode"] = "front-page";
        settingValues["post-score-threshold"] = 10;

        await expect(checkItem({itemType: "post", itemOverrides: {score}})).resolves.toBe(allowed);
    });

    it("preserves inclusion precedence over the front-page score threshold", async () => {
        settingValues["relay-mode"] = "front-page";
        settingValues["post-score-threshold"] = 100;
        settingValues["specific-username"] = "alice";

        await expect(checkItem({itemType: "post", itemOverrides: {score: 1}})).resolves.toBe(true);
    });
});

function checkItem({
    itemType,
    authorFlair,
    postFlair,
    itemOverrides,
}: {
    itemType: ItemType;
    authorFlair?: FlairLike | undefined;
    postFlair?: FlairLike | undefined;
    itemOverrides?: Record<string, unknown>;
}) {
    const item = itemType === "comment" ? makeComment(itemOverrides) : makePost(itemOverrides);

    return shouldRelay({
        item,
        itemType,
        authorName: "alice",
        authorFlair,
        postFlair,
    });
}
