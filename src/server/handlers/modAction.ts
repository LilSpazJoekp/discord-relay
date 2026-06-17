import {reddit, redis} from "@devvit/web/server";
import type {OnModActionRequest} from "@devvit/web/shared";

import type {RedditItem} from "../types.js";
import {scheduleRelay} from "../services/relay.js";
import {getUniqueId} from "../utils/items.js";
import {toCommentId, toPostId} from "../utils/redditIds.js";
import {getBooleanSetting} from "../utils/settings.js";

export async function handleModActionTrigger(event: OnModActionRequest) {
    if (event.action !== "approvelink" && event.action !== "approvecomment") {
        return;
    }
    const retryOnApproval = await getBooleanSetting("retry-on-approval");
    if (!retryOnApproval) {
        return;
    }
    let target: RedditItem;
    let uniqueId: string;
    if (event.action === "approvelink") {
        if (!event.targetPost?.id) {
            return;
        }
        target = await reddit.getPostById(toPostId(event.targetPost.id));
        uniqueId = target.id;
    } else {
        if (!event.targetComment?.id) {
            return;
        }
        const comment = await reddit.getCommentById(toCommentId(event.targetComment.id));
        target = comment;
        uniqueId = getUniqueId(comment);
    }
    console.log(`Received ${event.action} mod action (${uniqueId})`);
    const shouldRelayItem = await redis.hGet(target.id, "shouldRelay") === "true";
    const wasRelayed = await redis.hGet(target.id, "relayed") === "true";
    if (shouldRelayItem && !wasRelayed) {
        await scheduleRelay(target, true);
    } else {
        console.log(`Not relaying ${event.action} mod action (${uniqueId}) due to shouldRelayItem: ${shouldRelayItem} and wasRelayed: ${wasRelayed}`);
    }
}
