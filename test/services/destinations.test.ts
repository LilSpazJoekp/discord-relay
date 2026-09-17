import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    settings: {
        get: vi.fn(),
    },
}));

import {settings} from "@devvit/web/server";

import {getDestinations} from "../../src/server/services/destinations.js";

const getSetting = vi.mocked(settings.get);

describe("destinations", () => {
    beforeEach(() => {
        getSetting.mockReset();
    });

    it("matches configured destination by bucket", async () => {
        getSetting.mockImplementation(async (name) => {
            if (name === "reported-enabled") {
                return true;
            }
            if (name === "destination-1-url") {
                return "https://discord.com/api/webhooks/123/token";
            }
            if (name === "destination-1-events") {
                return ["reported"];
            }
            return undefined;
        });

        await expect(getDestinations("reported")).resolves.toEqual([{
            id: "destination-1",
            webhookUrl: "https://discord.com/api/webhooks/123/token",
            events: ["reported"],
        }]);
    });

    it("does not return destinations for disabled buckets", async () => {
        getSetting.mockImplementation(async (name) => {
            if (name === "reported-enabled") {
                return false;
            }
            if (name === "destination-1-url") {
                return "https://discord.com/api/webhooks/123/token";
            }
            if (name === "destination-1-events") {
                return ["reported"];
            }
            return undefined;
        });

        await expect(getDestinations("reported")).resolves.toEqual([]);
    });

    it("does not return disabled destination slots", async () => {
        getSetting.mockImplementation(async (name) => {
            if (name === "reported-enabled") {
                return true;
            }
            if (name === "destination-1-enabled") {
                return false;
            }
            if (name === "destination-1-url") {
                return "https://discord.com/api/webhooks/123/token";
            }
            if (name === "destination-1-events") {
                return ["reported"];
            }
            return undefined;
        });

        await expect(getDestinations("reported")).resolves.toEqual([]);
    });

    it("uses the legacy webhook URL for unmoderated when no destinations are configured", async () => {
        getSetting.mockImplementation(async (name) => name === "webhook-url"
            ? "https://hooks.slack.com/services/T/B/C"
            : undefined);

        await expect(getDestinations("unmoderated", "post")).resolves.toEqual([{
            id: "legacy-webhook-url",
            webhookUrl: "https://hooks.slack.com/services/T/B/C",
            events: ["unmoderated"],
        }]);
    });

    it("does not use legacy fallback for non-unmoderated buckets", async () => {
        getSetting.mockImplementation(async (name) => name === "webhook-url"
            ? "https://hooks.slack.com/services/T/B/C"
            : undefined);

        await expect(getDestinations("modlog")).resolves.toEqual([]);
    });
});
