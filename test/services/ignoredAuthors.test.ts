import {beforeEach, describe, expect, it, vi} from "vitest";

const getCurrentSubreddit = vi.fn();
const getModerators = vi.fn();

vi.mock("@devvit/web/server", () => ({
    reddit: {
        getCurrentSubreddit: () => getCurrentSubreddit(),
    },
    settings: {
        get: vi.fn(),
    },
}));

import {settings} from "@devvit/web/server";

import {isIgnoredAuthor} from "../../src/server/services/ignoredAuthors.js";

let settingValues: Record<string, unknown>;

describe("isIgnoredAuthor", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        getCurrentSubreddit.mockReset();
        getModerators.mockReset();
        settingValues = {};
        vi.mocked(settings.get).mockImplementation(async (name) => settingValues[String(name)] as never);
        // getModerators({username}) filters server-side, so only matches come back.
        getModerators.mockImplementation(({username}: {username?: string} = {}) => ({
            all: async () => (username === "amod" ? [{username: "amod"}] : []),
        }));
        getCurrentSubreddit.mockResolvedValue({getModerators});
    });

    it("does not ignore anyone when no list is configured", async () => {
        await expect(isIgnoredAuthor("alice")).resolves.toBe(false);
    });

    it("ignores a globally configured username", async () => {
        settingValues["global-ignore-usernames"] = "automoderator";
        await expect(isIgnoredAuthor("AutoModerator")).resolves.toBe(true);
    });

    it.each([
        "AutoModerator",
        "u/automoderator",
        "/u/AutoModerator",
        " automoderator ",
        "someone, automoderator",
    ])("normalises configured entry %s", async (configured) => {
        settingValues["global-ignore-usernames"] = configured;
        await expect(isIgnoredAuthor("automoderator")).resolves.toBe(true);
    });

    it.each(["u/automoderator", "/u/AutoModerator"])("normalises the author name %s", async (authorName) => {
        settingValues["global-ignore-usernames"] = "automoderator";
        await expect(isIgnoredAuthor(authorName)).resolves.toBe(true);
    });

    it("leaves authors that are not listed alone", async () => {
        settingValues["global-ignore-usernames"] = "automoderator";
        await expect(isIgnoredAuthor("alice")).resolves.toBe(false);
    });

    it("ignores an empty or missing author name", async () => {
        settingValues["global-ignore-usernames"] = "m";
        await expect(isIgnoredAuthor("")).resolves.toBe(false);
        await expect(isIgnoredAuthor(undefined)).resolves.toBe(false);
    });

    it("merges a bucket-specific list with the global one", async () => {
        settingValues["global-ignore-usernames"] = "automoderator";
        settingValues["modmail-ignore-usernames"] = "auto-modmail";

        await expect(isIgnoredAuthor("auto-modmail", {additionalSettingName: "modmail-ignore-usernames"}))
            .resolves.toBe(true);
        await expect(isIgnoredAuthor("automoderator", {additionalSettingName: "modmail-ignore-usernames"}))
            .resolves.toBe(true);
        // the bucket list must not leak into buckets that do not ask for it
        await expect(isIgnoredAuthor("auto-modmail")).resolves.toBe(false);
    });

    describe("the m token", () => {
        beforeEach(() => {
            settingValues["global-ignore-usernames"] = "m";
        });

        it("ignores a moderator confirmed by the moderator list", async () => {
            await expect(isIgnoredAuthor("amod")).resolves.toBe(true);
        });

        it("does not ignore a non-moderator", async () => {
            await expect(isIgnoredAuthor("alice")).resolves.toBe(false);
        });

        it("trusts a known moderator status without calling the API", async () => {
            await expect(isIgnoredAuthor("alice", {isModerator: true})).resolves.toBe(true);
            expect(getCurrentSubreddit).not.toHaveBeenCalled();
        });

        it("still checks the moderator list when the event claims non-moderator", async () => {
            await expect(isIgnoredAuthor("amod", {isModerator: false})).resolves.toBe(true);
        });

        it("is not applied when the bucket opts out, but named users still are", async () => {
            await expect(isIgnoredAuthor("amod", {matchModeratorToken: false})).resolves.toBe(false);

            settingValues["global-ignore-usernames"] = "m,amod";
            await expect(isIgnoredAuthor("amod", {matchModeratorToken: false})).resolves.toBe(true);
        });

        it("does not ignore anyone when the moderator lookup fails", async () => {
            getCurrentSubreddit.mockRejectedValue(new Error("boom"));
            await expect(isIgnoredAuthor("amod")).resolves.toBe(false);
        });
    });
});
