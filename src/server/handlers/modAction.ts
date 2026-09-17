import {reddit, redis} from "@devvit/web/server";
import type {OnModActionRequest} from "@devvit/web/shared";

import type {RedditItem} from "../types.js";
import {getDestinations, isBucketEnabled} from "../services/destinations.js";
import {buildModActionMessage} from "../services/messages.js";
import {relayToDestinations, scheduleRelay} from "../services/relay.js";
import {getUniqueId} from "../utils/items.js";
import {toCommentId, toPostId} from "../utils/redditIds.js";
import {getBooleanSetting, getStringArraySetting} from "../utils/settings.js";

export async function handleModActionTrigger(event: OnModActionRequest) {
    await handleModlogRelay(event);

    if (event.action !== "approvelink" && event.action !== "approvecomment") {
        return;
    }
    if (!await isBucketEnabled("unmoderated")) {
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
    const wasRelayed = await redis.hGet(target.id, "unmoderated:legacy-webhook-url:relayed") === "true";
    if (shouldRelayItem && !wasRelayed) {
        await scheduleRelay(target, true);
    } else {
        console.log(`Not relaying ${event.action} mod action (${uniqueId}) due to shouldRelayItem: ${shouldRelayItem} and wasRelayed: ${wasRelayed}`);
    }
}

async function handleModlogRelay(event: OnModActionRequest) {
    if (!await isBucketEnabled("modlog")) {
        return;
    }

    const configuredActions = await getStringArraySetting("modlog-actions");
    const action = event.action || "unknown";
    if (configuredActions.length > 0 && !configuredActions.includes("all") && !configuredActions.includes(action)) {
        return;
    }

    const destinations = await getDestinations("modlog");
    if (destinations.length === 0) {
        return;
    }

    await relayToDestinations({
        bucket: "modlog",
        destinations,
        message: buildModActionMessage(event),
        uniqueId: event.id || `${action}:${Date.now()}`,
    });
}
