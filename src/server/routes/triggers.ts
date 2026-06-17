import {Hono} from "hono";
import type {
    OnModActionRequest,
} from "@devvit/web/shared";

import {handleContentTrigger} from "../handlers/content.js";
import {handleModActionTrigger} from "../handlers/modAction.js";
import {resetFrontPageScheduler} from "../services/frontPageScheduler.js";
import type {ContentTriggerRequest, LifecycleTriggerRequest} from "../types.js";

export const triggersRouter = new Hono();

triggersRouter.post(
    "/internal/triggers/app-lifecycle",
    async (c) => {
        await c.req.json<LifecycleTriggerRequest>();
        await resetFrontPageScheduler();
        return c.json({}, 200);
    },
);

triggersRouter.post(
    "/internal/triggers/content",
    async (c) => {
        const body = await c.req.json<ContentTriggerRequest>();
        await handleContentTrigger(body);
        return c.json({}, 200);
    },
);

triggersRouter.post(
    "/internal/triggers/mod-action",
    async (c) => {
        const body = await c.req.json<OnModActionRequest>();
        await handleModActionTrigger(body);
        return c.json({}, 200);
    },
);
