import {describe, expect, it} from "vitest";

import {toCommentId, toPostId, toUserId} from "../../src/server/utils/redditIds.js";

describe("reddit id utilities", () => {
    it("adds missing thing prefixes", () => {
        expect(toCommentId("abc")).toBe("t1_abc");
        expect(toPostId("def")).toBe("t3_def");
        expect(toUserId("ghi")).toBe("t2_ghi");
    });

    it("keeps existing thing prefixes", () => {
        expect(toCommentId("t1_abc")).toBe("t1_abc");
        expect(toPostId("t3_def")).toBe("t3_def");
        expect(toUserId("t2_ghi")).toBe("t2_ghi");
    });
});
