import {describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    settings: {
        get: vi.fn(),
    },
}));

import {Hono} from "hono";

import {settingsRouter} from "../../src/server/routes/settings.js";

function createTestApp() {
    const app = new Hono();
    app.route("/", settingsRouter);
    return app;
}

describe("settings routes", () => {
    it("accepts an empty webhook URL", async () => {
        const response = await createTestApp().request("/internal/settings/validate-webhook-url", {
            method: "POST",
            body: JSON.stringify({value: ""}),
            headers: {"content-type": "application/json"},
        });

        await expect(response.json()).resolves.toEqual({success: true});
        expect(response.status).toBe(200);
    });

    it("accepts a non-empty webhook URL", async () => {
        const response = await createTestApp().request("/internal/settings/validate-webhook-url", {
            method: "POST",
            body: JSON.stringify({value: "https://discord.com/api/webhooks/example"}),
            headers: {"content-type": "application/json"},
        });

        await expect(response.json()).resolves.toEqual({success: true});
        expect(response.status).toBe(200);
    });

    it("rejects delay values below the minimum except zero", async () => {
        const response = await createTestApp().request("/internal/settings/validate-delay", {
            method: "POST",
            body: JSON.stringify({value: 2}),
            headers: {"content-type": "application/json"},
        });

        await expect(response.json()).resolves.toEqual({
            success: false,
            error: "Please enter a delay of at least 3 minutes",
        });
        expect(response.status).toBe(200);
    });

    it("accepts zero and minimum delay values", async () => {
        for (const value of [0, 3]) {
            const response = await createTestApp().request("/internal/settings/validate-delay", {
                method: "POST",
                body: JSON.stringify({value}),
                headers: {"content-type": "application/json"},
            });

            await expect(response.json()).resolves.toEqual({success: true});
            expect(response.status).toBe(200);
        }
    });
});
