import {getRequestListener} from "@hono/node-server";
import {createServer, getServerPort} from "@devvit/web/server";

import {createApp} from "./app.js";

const app = createApp();
const server = createServer(getRequestListener((request, env) => app.fetch(request, env)));
server.on("error", (err: Error) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
