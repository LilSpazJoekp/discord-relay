import {Hono} from "hono";
import type {
    SettingsValidationRequest,
} from "@devvit/web/shared";

import {validateDelay} from "../utils/settings.js";

export const settingsRouter = new Hono();

settingsRouter.post(
    "/internal/settings/validate-webhook-url",
    async (c) => {
        await c.req.json<SettingsValidationRequest<string>>();
        return c.json({success: true}, 200);
    },
);

settingsRouter.post(
    "/internal/settings/validate-delay",
    async (c) => {
        const body = await c.req.json<SettingsValidationRequest<number>>();
        const error = validateDelay(body.value);
        if (error) {
            return c.json({success: false, error}, 200);
        }
        return c.json({success: true}, 200);
    },
);
