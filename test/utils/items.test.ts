import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {RedditItem} from "../../src/server/types.js";
import {getUniqueId, isCommentItem, isPostItem, isRemoved} from "../../src/server/utils/items.js";

describe("item utilities", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("identifies comments and builds comment unique ids", () => {
        const comment = {
            id: "abc",
            parentId: "t3_parent",
        } as unknown as RedditItem;

        expect(isCommentItem(comment)).toBe(true);
        expect(isPostItem(comment)).toBe(false);
        expect(getUniqueId(comment)).toBe("t3_parent/abc");
    });

    it("identifies posts and uses the post id as the unique id", () => {
        const post = {
            id: "post123",
        } as unknown as RedditItem;

        expect(isPostItem(post)).toBe(true);
        expect(isCommentItem(post)).toBe(false);
        expect(getUniqueId(post)).toBe("post123");
    });

    it.each([
        [{spam: true}, "spam"],
        [{removed: true}, "removed"],
        [{removedByCategory: "automod_filtered"}, "automod filtered"],
        [{removedBy: "AutoModerator"}, "automoderator removal"],
        [{removedBy: true}, "truthy removedBy"],
        [{removalReason: "legal"}, "legal removal"],
    ])("detects removed items from %s", (flags, _label) => {
        expect(isRemoved(flags as unknown as RedditItem)).toBe(true);
    });

    it("does not mark visible items as removed", () => {
        expect(isRemoved({spam: false, removed: false} as RedditItem)).toBe(false);
    });
});
