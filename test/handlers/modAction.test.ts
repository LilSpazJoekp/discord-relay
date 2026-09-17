import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {getPostById: vi.fn(), getCommentById: vi.fn()},
    redis: {hGet: vi.fn()},
    settings: {get: vi.fn()},
}));
vi.mock("../../src/server/services/destinations.js", () => ({getDestinations: vi.fn(), isBucketEnabled: vi.fn()}));
vi.mock("../../src/server/services/relay.js", () => ({relayToDestinations: vi.fn(), scheduleRelay: vi.fn()}));

import {reddit, redis, settings} from "@devvit/web/server";
import {handleModActionTrigger} from "../../src/server/handlers/modAction.js";
import {getDestinations, isBucketEnabled} from "../../src/server/services/destinations.js";
import {relayToDestinations, scheduleRelay} from "../../src/server/services/relay.js";
import type {RelayDestination} from "../../src/server/types.js";
import {makeComment, makePost} from "../helpers/items.js";

const destinations: RelayDestination[] = [{
    id: "destination-1", webhookUrl: "https://discord.com/api/webhooks/123/token", events: ["modlog"],
}];
let settingValues: Record<string, unknown>;

function actionEvent(overrides: Record<string, unknown> = {}) {
    return {type: "ModAction", id: "action1", action: "banuser", ...overrides} as Parameters<typeof handleModActionTrigger>[0];
}

describe("moderation actions", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-17T13:00:00Z"));
        settingValues = {"retry-on-approval": true};
        vi.mocked(settings.get).mockImplementation(async (name) => settingValues[name] as never);
        vi.mocked(isBucketEnabled).mockResolvedValue(true);
        vi.mocked(getDestinations).mockResolvedValue(destinations);
        vi.mocked(reddit.getPostById).mockResolvedValue(makePost());
        vi.mocked(reddit.getCommentById).mockResolvedValue(makeComment());
        vi.mocked(redis.hGet).mockImplementation(async (_key, field) => field === "shouldRelay" ? "true" : undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([{actions: []}, {actions: ["all"]}, {actions: ["banuser"]}])("forwards an action accepted by the configured list $actions", async ({actions}) => {
        settingValues["modlog-actions"] = actions;

        await handleModActionTrigger(actionEvent());

        expect(getDestinations).toHaveBeenCalledWith("modlog");
        expect(relayToDestinations).toHaveBeenCalledWith(expect.objectContaining({
            bucket: "modlog", destinations, uniqueId: "action1",
            message: expect.objectContaining({embed: expect.objectContaining({
                title: "Mod Action", fields: expect.arrayContaining([{name: "Action", value: "banuser"}]),
            })}),
        }));
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it("does not forward actions excluded from the configured list", async () => {
        settingValues["modlog-actions"] = ["removelink"];

        await handleModActionTrigger(actionEvent());

        expect(getDestinations).not.toHaveBeenCalled();
        expect(relayToDestinations).not.toHaveBeenCalled();
    });

    it("uses a timestamp-based identity for actions without an ID", async () => {
        await handleModActionTrigger(actionEvent({id: undefined, action: undefined}));

        expect(relayToDestinations).toHaveBeenCalledWith(expect.objectContaining({uniqueId: `unknown:${Date.now()}`}));
    });

    it("does not forward modlog events without a destination", async () => {
        vi.mocked(getDestinations).mockResolvedValue([]);

        await handleModActionTrigger(actionEvent());

        expect(relayToDestinations).not.toHaveBeenCalled();
    });

    it.each([
        {action: "approvelink", targetPost: {id: "post1"}, itemType: "post"},
        {action: "approvecomment", targetComment: {id: "comment1"}, itemType: "comment"},
    ])("retries eligible, undelivered content on $action even with modlog disabled", async ({itemType, ...event}) => {
        vi.mocked(isBucketEnabled).mockImplementation(async (bucket) => bucket !== "modlog");

        await handleModActionTrigger(actionEvent(event));

        const itemId = itemType === "post" ? "t3_post1" : "t1_comment1";
        expect(redis.hGet).toHaveBeenCalledWith(itemId, "shouldRelay");
        expect(redis.hGet).toHaveBeenCalledWith(itemId, "unmoderated:legacy-webhook-url:relayed");
        expect(scheduleRelay).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id: itemId}), true);
        expect(relayToDestinations).not.toHaveBeenCalled();
        expect(itemType === "post" ? reddit.getPostById : reddit.getCommentById).toHaveBeenCalledWith(itemId);
    });

    it.each([
        {eligible: "false", relayed: undefined},
        {eligible: undefined, relayed: undefined},
        {eligible: "true", relayed: "true"},
    ])("does not retry ineligible or previously delivered content: %j", async ({eligible, relayed}) => {
        vi.mocked(redis.hGet).mockImplementation(async (_key, field) => field === "shouldRelay" ? eligible : relayed);

        await handleModActionTrigger(actionEvent({action: "approvelink", targetPost: {id: "post1"}}));

        expect(scheduleRelay).not.toHaveBeenCalled();
        expect(relayToDestinations).toHaveBeenCalledOnce();
    });

    it.each(["approvelink", "approvecomment"])("ignores %s retries without a target ID", async (action) => {
        await handleModActionTrigger(actionEvent({action}));

        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(reddit.getCommentById).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });

    it.each(["unmoderated bucket", "retry setting"])("keeps modlog forwarding active when the %s is disabled", async (disabled) => {
        if (disabled === "unmoderated bucket") {
            vi.mocked(isBucketEnabled).mockImplementation(async (bucket) => bucket !== "unmoderated");
        } else {
            settingValues["retry-on-approval"] = false;
        }

        await handleModActionTrigger(actionEvent({action: "approvelink", targetPost: {id: "post1"}}));

        expect(relayToDestinations).toHaveBeenCalledOnce();
        expect(reddit.getPostById).not.toHaveBeenCalled();
        expect(scheduleRelay).not.toHaveBeenCalled();
    });
});
