import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    settings: {
        get: vi.fn(),
    },
}));

import {settings} from "@devvit/web/server";
import {
    getBooleanSetting,
    getNumberSetting,
    getStringArraySetting,
    getStringSetting,
    validateDelay,
} from "../../src/server/utils/settings.js";

const getSetting = vi.mocked(settings.get);

describe("settings utilities", () => {
    beforeEach(() => {
        getSetting.mockReset();
    });

    it("validates delay values", () => {
        expect(validateDelay(0)).toBeUndefined();
        expect(validateDelay(3)).toBeUndefined();
        expect(validateDelay(2)).toBe("Please enter a delay of at least 3 minutes");
    });

    it("reads string settings and falls back for non-strings", async () => {
        getSetting.mockResolvedValueOnce(["configured"]);
        await expect(getStringSetting("webhook-url", "default")).resolves.toBe("configured");

        getSetting.mockResolvedValueOnce(12);
        await expect(getStringSetting("webhook-url", "default")).resolves.toBe("default");
    });

    it("reads boolean settings from booleans and strings", async () => {
        getSetting.mockResolvedValueOnce(true);
        await expect(getBooleanSetting("enabled")).resolves.toBe(true);

        getSetting.mockResolvedValueOnce("true");
        await expect(getBooleanSetting("enabled")).resolves.toBe(true);

        getSetting.mockResolvedValueOnce(undefined);
        await expect(getBooleanSetting("enabled", true)).resolves.toBe(true);
    });

    it("reads number settings from numbers and numeric strings", async () => {
        getSetting.mockResolvedValueOnce(7);
        await expect(getNumberSetting("delay")).resolves.toBe(7);

        getSetting.mockResolvedValueOnce("12");
        await expect(getNumberSetting("delay")).resolves.toBe(12);

        getSetting.mockResolvedValueOnce("not-a-number");
        await expect(getNumberSetting("delay", 5)).resolves.toBe(5);
    });

    it("reads string array settings from multi-select values", async () => {
        getSetting.mockResolvedValueOnce(["post", "reported"]);
        await expect(getStringArraySetting("destination-1-events")).resolves.toEqual(["post", "reported"]);

        getSetting.mockResolvedValueOnce("all");
        await expect(getStringArraySetting("destination-1-events")).resolves.toEqual(["all"]);
    });
});
