import {Hono} from "hono";
import {reddit, redis} from "@devvit/web/server";
import type {TaskRequest, TaskResponse} from "@devvit/web/server";

import {relay, scheduleRelay} from "../services/relay.js";
import {shouldRelay} from "../services/shouldRelay.js";
import type {RelayJobData} from "../types.js";
import {isRemoved} from "../utils/items.js";
import {toCommentId, toPostId} from "../utils/redditIds.js";
import {getBooleanSetting, getStringSetting} from "../utils/settings.js";

export const schedulerRouter = new Hono();

schedulerRouter.post(
    "/internal/scheduler/relay",
    async (c) => {
        const {data} = await c.req.json<TaskRequest<RelayJobData>>();
        if (!data) {
            console.log("Relay scheduled job missing data");
            return c.json<TaskResponse>({}, 400);
        }
        const {
            data: payload,
            itemId,
            itemType,
            uniqueId,
            webhookUrl,
        } = data;
        const item = itemType === "post"
            ? await reddit.getPostById(toPostId(itemId))
            : await reddit.getCommentById(toCommentId(itemId));
        if (await getBooleanSetting("ignore-removed") && isRemoved(item)) {
            console.log(`Not relaying due to item removed: ${uniqueId}`);
            return c.json<TaskResponse>({}, 200);
        }
        console.log(`Relaying event ${uniqueId}`);
        await relay(item, webhookUrl, payload);
        return c.json<TaskResponse>({}, 200);
    },
);

schedulerRouter.post(
    "/internal/scheduler/check-front-page",
    async (c) => {
        await c.req.json<TaskRequest>();
        const relayMode = await getStringSetting("relay-mode", "immediately");
        if (relayMode !== "front-page") {
            return c.json<TaskResponse>({}, 200);
        }
        console.log("Checking front page");
        const subreddit = await reddit.getCurrentSubreddit();
        const posts = await subreddit.getTopPosts({limit: 100}).all();
        console.log(`Checking ${posts.length} posts`);
        await Promise.all(posts.map(async (post) => {
            const shouldRelayItem = await shouldRelay({
                item: post,
                itemType: "post",
                authorName: post.authorName,
                authorFlair: post.authorFlair,
                postFlair: post.flair,
            });
            await redis.hSet(post.id, {shouldRelay: shouldRelayItem.toString()});
            if (shouldRelayItem) {
                await scheduleRelay(post, false);
            }
        }));
        return c.json<TaskResponse>({}, 200);
    },
);
