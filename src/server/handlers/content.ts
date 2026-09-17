import {reddit, redis} from "@devvit/web/server";

import type {ItemType, ContentTriggerRequest} from "../types.js";
import {isBucketEnabled} from "../services/destinations.js";
import {scheduleRelay} from "../services/relay.js";
import {shouldRelay} from "../services/shouldRelay.js";
import {getUniqueId, isPostItem} from "../utils/items.js";
import {toCommentId, toPostId} from "../utils/redditIds.js";
import {getBooleanSetting, getStringSetting} from "../utils/settings.js";

export async function handleContentTrigger(event: ContentTriggerRequest) {
    if (!await isBucketEnabled("unmoderated")) {
        return;
    }

    const skipSafetyChecks = await getBooleanSetting("skip-safety-checks");
    if (isSubmitEvent(event) === !skipSafetyChecks) {
        console.log(`${skipSafetyChecks ? "Skipping" : "Waiting for"} safety checks`);
        return;
    }
    const relayMode = await getStringSetting("relay-mode", "immediately");
    if (relayMode === "front-page") {
        return;
    }

    const commentEvent = isCommentEvent(event);
    const itemType: ItemType = commentEvent ? "comment" : "post";
    const itemId = commentEvent ? event.comment?.id : event.post?.id;
    if (!itemId) {
        console.log(`Skipping ${event.type}: event did not include an item ID`);
        return;
    }
    const item = commentEvent
        ? await reddit.getCommentById(toCommentId(itemId))
        : await reddit.getPostById(toPostId(itemId));
    const authorName = event.author?.name || item.authorName;
    const uniqueId = getUniqueId(item);

    console.log(`Received ${event.type} event (${uniqueId}) by u/${authorName}`);
    const shouldRelayItem = await shouldRelay({
        item,
        itemType,
        authorName,
        authorFlair: event.author?.flair || item.authorFlair,
        postFlair: commentEvent ? undefined : event.post?.linkFlair || (isPostItem(item) ? item.flair : undefined),
    });
    await redis.hSet(item.id, {shouldRelay: shouldRelayItem.toString()});
    if (shouldRelayItem) {
        await scheduleRelay(item, false);
    }
}

function isSubmitEvent(event: ContentTriggerRequest) {
    return event.type === "CommentSubmit" || event.type === "PostSubmit";
}

function isCommentEvent(event: ContentTriggerRequest) {
    return event.type === "CommentCreate" || event.type === "CommentSubmit";
}
