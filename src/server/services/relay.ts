import {redis, scheduler, type User} from "@devvit/web/server";

import {RELAY_SCHEDULED_JOB} from "../constants.js";
import type {ItemType, RedditItem, RelayBucket, RelayDestination, RelayMessage} from "../types.js";
import {getDestinations} from "./destinations.js";
import {buildWebhookPayload} from "./webhookPayloads.js";
import {getUniqueId, isCommentItem, isRemoved} from "../utils/items.js";
import {getBooleanSetting, getNumberSetting, getStringSetting} from "../utils/settings.js";

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
    let message = `New [${itemType}](${suppressItemEmbed
        ? "<"
        : ""}https://www.reddit.com${item.permalink}${suppressItemEmbed
        ? ">"
        : ""}) by [u/${username}](${suppressAuthorEmbed ? "<" : ""}${authorUrl}${suppressAuthorEmbed ? ">" : ""})!`;
    if (await getBooleanSetting("ping-role")) {
        const roleId = await getStringSetting("ping-role-id");
        message = `${message}\n<@&${roleId}>`;
    }
    const data: RelayMessage = {
        content: message,
    };
    const destinations = await getDestinations(bucket, itemType);
    if (destinations.length === 0) {
        console.log(`No destinations configured for ${bucket} ${uniqueId}`);
        return;
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
                    message: data,
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
        await relayWebhook(trackingKey, destination.webhookUrl, message);
        if (item) {
            await redis.hSet(item.id, {[`${bucket}:${destination.id}:relayed`]: "true"});
            if (itemType) {
                await redis.hSet(item.id, {[`${itemType}:${destination.id}:relayed`]: "true"});
            }
        }
    }));
}

function getTrackingKey(bucket: RelayBucket, destinationId: string, uniqueId: string) {
    return `relay:${bucket}:${destinationId}:${uniqueId}`;
}
