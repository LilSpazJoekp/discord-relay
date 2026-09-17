import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({reddit: {}, redis: {}, settings: {get: vi.fn()}}));
vi.mock("../../src/server/handlers/content.js", () => ({handleContentTrigger: vi.fn()}));
vi.mock("../../src/server/handlers/modAction.js", () => ({handleModActionTrigger: vi.fn()}));
vi.mock("../../src/server/handlers/modmail.js", () => ({handleModmailTrigger: vi.fn()}));
vi.mock("../../src/server/handlers/reported.js", () => ({handleReportedTrigger: vi.fn()}));
vi.mock("../../src/server/services/frontPageScheduler.js", () => ({resetSchedulers: vi.fn()}));
vi.mock("../../src/server/services/relay.js", () => ({relayWebhook: vi.fn(), scheduleRelay: vi.fn()}));

import {createApp} from "../../src/server/app.js";
import {handleContentTrigger} from "../../src/server/handlers/content.js";
import {handleModActionTrigger} from "../../src/server/handlers/modAction.js";
import {handleModmailTrigger} from "../../src/server/handlers/modmail.js";
import {handleReportedTrigger} from "../../src/server/handlers/reported.js";
import {resetSchedulers} from "../../src/server/services/frontPageScheduler.js";

describe("application trigger routes", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it.each([
        {route: "content", type: "PostCreate", handler: handleContentTrigger},
        {route: "mod-action", type: "ModAction", handler: handleModActionTrigger},
        {route: "modmail", type: "ModMail", handler: handleModmailTrigger},
        {route: "reported", type: "PostReport", handler: handleReportedTrigger},
    ])("dispatches $type payloads to the $route handler", async ({route, type, handler}) => {
        const event = {type, id: "event1", extra: {preserved: true}};
        const response = await createApp().request(`/internal/triggers/${route}`, {
            method: "POST", body: JSON.stringify(event), headers: {"Content-Type": "application/json"},
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({});
        expect(handler).toHaveBeenCalledExactlyOnceWith(event);
    });

    it.each(["AppInstall", "AppUpgrade"])("resets recurring jobs on %s", async (type) => {
        const response = await createApp().request("/internal/triggers/app-lifecycle", {
            method: "POST", body: JSON.stringify({type}), headers: {"Content-Type": "application/json"},
        });

        expect(response.status).toBe(200);
        expect(resetSchedulers).toHaveBeenCalledOnce();
    });

    it("rejects invalid JSON without calling the handler", async () => {
        const response = await createApp().request("/internal/triggers/content", {method: "POST", body: "{"});

        expect(response.status).toBe(500);
        expect(handleContentTrigger).not.toHaveBeenCalled();
    });

    it("does not acknowledge a trigger when its handler fails", async () => {
        vi.mocked(handleContentTrigger).mockRejectedValue(new Error("Reddit unavailable"));
        const response = await createApp().request("/internal/triggers/content", {
            method: "POST", body: JSON.stringify({type: "PostCreate"}),
        });

        expect(response.status).toBe(500);
    });

    it("mounts settings and scheduler routes alongside triggers", async () => {
        const app = createApp();
        const validation = await app.request("/internal/settings/validate-delay", {
            method: "POST", body: JSON.stringify({value: 3}),
        });
        const scheduled = await app.request("/internal/scheduler/relay", {method: "POST", body: "{}"});

        expect(validation.status).toBe(200);
        await expect(validation.json()).resolves.toEqual({success: true});
        expect(scheduled.status).toBe(400);
    });
});
