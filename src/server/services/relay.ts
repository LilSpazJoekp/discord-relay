import {reddit, redis, scheduler, type Post, type User} from "@devvit/web/server";

import {RELAY_SCHEDULED_JOB} from "../constants.js";
import type {ItemType, RedditItem, RelayBucket, RelayDestination, RelayMessage} from "../types.js";
import {getDestinations} from "./destinations.js";
import {getDestinationMentions} from "./mentions.js";
import {buildUnmoderatedSlackMessage} from "./slackBlocks.js";
import {buildWebhookPayload, detectWebhookProvider} from "./webhookPayloads.js";
import {getUniqueId, isCommentItem, isRemoved} from "../utils/items.js";
import {toPostId} from "../utils/redditIds.js";
import {getBooleanSetting, getNumberSetting} from "../utils/settings.js";

export async function relayWebhook(
    trackingKey: string,
    webhookUrl: string,
    message: RelayMessage,
) {
    // Atomically claim each bucket/destination pair so one item can fan out safely.
    const claimed = await redis.hSetNX(trackingKey, "relayed", "true");
    if (claimed === 0) {
        console.log(`Skipping duplicate relay for ${trackingKey}: already relayed or being relayed by another worker`);
        return;
    }
    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(buildWebhookPayload(webhookUrl, message)),
        });
        console.log(`Webhook response: ${response.status} ${await response.text()}`);
    } catch (err) {
        await redis.hDel(trackingKey, ["relayed"]);
        throw err;
    }
}

export async function scheduleRelay(item: RedditItem, approvalRetry: boolean) {
    const author = await item.getAuthor() as User | undefined;
    const itemType: ItemType = isCommentItem(item) ? "comment" : "post";
    const uniqueId = getUniqueId(item);
    const bucket: RelayBucket = "unmoderated";
    const delayKey = `${itemType}-delay`;
    const delay = await getNumberSetting(`${delayKey}${approvalRetry ? "-after-approval" : ""}`);
    const suppressAuthorEmbed = await getBooleanSetting("suppress-author-embed");
    const suppressItemEmbed = await getBooleanSetting("suppress-item-embed");
    const username = author?.username || item.authorName;
    const authorUrl = author?.url || `https://www.reddit.com/user/${username}`;
    const message = `New [${itemType}](${suppressItemEmbed
        ? "<"
        : ""}https://www.reddit.com${item.permalink}${suppressItemEmbed
        ? ">"
        : ""}) by [u/${username}](${suppressAuthorEmbed ? "<" : ""}${authorUrl}${suppressAuthorEmbed ? ">" : ""})!`;
    const destinations = await getDestinations(bucket, itemType);
    if (destinations.length === 0) {
        console.log(`No destinations configured for ${bucket} ${uniqueId}`);
        return;
    }
    const data: RelayMessage = {
        content: message,
    };
    if (destinations.some((destination) => detectWebhookProvider(destination.webhookUrl) === "slack")) {
        data.slack = buildUnmoderatedSlackMessage(item, username, await getParentPost(item));
    }
    if (delay === 0) {
        console.log(`Relaying event ${uniqueId}`);
        if (await getBooleanSetting("ignore-removed") && isRemoved(item)) {
            console.log(`Not relaying due to item removed: ${uniqueId}`);
            return;
        }
        await relayToDestinations({
            item,
            bucket,
            itemType,
            uniqueId,
            destinations,
            message: data,
        });
    } else {
        const runAt = new Date(Date.now() + delay * 60 * 1000);
        console.log(`Scheduling relay (${uniqueId}) for ${delay} minutes from now (${runAt})`);
        await Promise.all(destinations.map(async (destination) => {
            const trackingKey = getTrackingKey(bucket, destination.id, uniqueId);
            if (await redis.hGet(trackingKey, "scheduled") === "true") {
                console.log(`Relay job already scheduled for ${trackingKey}`);
                return;
            }
            await scheduler.runJob({
                name: RELAY_SCHEDULED_JOB,
                data: {
                    bucket,
                    destinationId: destination.id,
                    message: await withDestinationMentions(bucket, destination, data),
                    itemType,
                    itemId: item.id,
                    trackingKey,
                    uniqueId,
                    webhookUrl: destination.webhookUrl,
                },
                runAt,
            });
            await redis.hSet(trackingKey, {scheduled: "true"});
        }));
    }
}

export async function relayToDestinations(
    {
        bucket,
        destinations,
        item,
        itemType,
        message,
        uniqueId,
    }: {
        bucket: RelayBucket;
        destinations: RelayDestination[];
        item?: RedditItem;
        itemType?: ItemType;
        message: RelayMessage;
        uniqueId: string;
    }) {
    await Promise.all(destinations.map(async (destination) => {
        const trackingKey = getTrackingKey(bucket, destination.id, uniqueId);
        if (item && await getBooleanSetting("ignore-removed") && isRemoved(item)) {
            console.log(`Not relaying due to item removed: ${trackingKey}`);
            return;
        }
        console.log(`Relaying ${bucket} event ${trackingKey}`);
        await relayWebhook(trackingKey, destination.webhookUrl, await withDestinationMentions(bucket, destination, message));
        if (item) {
            await redis.hSet(item.id, {[`${bucket}:${destination.id}:relayed`]: "true"});
            if (itemType) {
                await redis.hSet(item.id, {[`${itemType}:${destination.id}:relayed`]: "true"});
            }
        }
    }));
}

async function withDestinationMentions(
    bucket: RelayBucket,
    destination: RelayDestination,
    message: RelayMessage,
): Promise<RelayMessage> {
    const mentions = await getDestinationMentions(bucket, destination);
    return mentions ? {...message, mentions} : message;
}

// A comment's title comes from its parent post. A failed lookup only costs the title,
// so it must not stop the alert.
async function getParentPost(item: RedditItem): Promise<Post | undefined> {
    if (!isCommentItem(item)) {
        return undefined;
    }
    try {
        return await reddit.getPostById(toPostId(item.postId));
    } catch (err) {
        console.log(`Unable to load parent post ${item.postId} for ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
    }
}

function getTrackingKey(bucket: RelayBucket, destinationId: string, uniqueId: string) {
    return `relay:${bucket}:${destinationId}:${uniqueId}`;
}
