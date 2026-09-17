import {describe, expect, it} from "vitest";

import {matchesFlair, matchesFlairTemplateId, normalize, splitCsv} from "../../src/server/utils/flair.js";

describe("flair utilities", () => {
    it("normalizes missing and mixed-case values", () => {
        expect(normalize(undefined)).toBe("");
        expect(normalize("Mod Approved")).toBe("mod approved");
    });

    it("splits comma-separated settings into normalized values", () => {
        expect(splitCsv(" Alice,BOB, , Carol ")).toEqual(["alice", "bob", "carol"]);
    });

    it("matches flair by text", () => {
        expect(matchesFlair(["helper"], {text: "Helper"}, new Map())).toBe(true);
    });

    it("matches flair by template id lookup", () => {
        const flairMap = new Map([["template-1", "trusted"]]);

        expect(matchesFlair(["trusted"], {templateId: "template-1"}, flairMap)).toBe(true);
    });

    it("matches a configured template ID directly", () => {
        expect(matchesFlairTemplateId(
            ["8f123abc-456d"],
            {text: "A different flair text", templateId: "8F123ABC-456D"},
        )).toBe(true);
    });

    it("does not match a missing template ID", () => {
        expect(matchesFlairTemplateId(["template-1"], {text: "Trusted"})).toBe(false);
    });

    it("does not match missing flair", () => {
        expect(matchesFlair(["trusted"], undefined, new Map())).toBe(false);
    });
});
