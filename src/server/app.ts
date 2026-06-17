import {Hono} from "hono";

import {schedulerRouter} from "./routes/scheduler.js";
import {settingsRouter} from "./routes/settings.js";
import {triggersRouter} from "./routes/triggers.js";

export function createApp() {
    const app = new Hono();

    app.route("/", settingsRouter);
    app.route("/", triggersRouter);
    app.route("/", schedulerRouter);

    return app;
}
