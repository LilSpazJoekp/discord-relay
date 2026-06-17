import {redis, scheduler, type User} from "@devvit/web/server";

import {RELAY_SCHEDULED_JOB} from "../constants.js";
import type {ItemType, RedditItem, RelayPayload} from "../types.js";
import {isCommentItem, isRemoved, getUniqueId} from "../utils/items.js";
import {getBooleanSetting, getNumberSetting, getStringSetting} from "../utils/settings.js";

export async function relay(
    item: RedditItem,
    webhookUrl: string,
    data: RelayPayload,
) {
    // Atomically claim "relayed" before firing the webhook to prevent duplicate relays.
    const claimed = await redis.hSetNX(item.id, "relayed", "true");
    if (claimed === 0) {
        console.log(`Skipping duplicate relay for ${item.id}: already relayed or being relayed by another worker`);
        return;
    }
    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });
        console.log(`Webhook response: ${response.status} ${await response.text()}`);
    } catch (err) {
        await redis.hDel(item.id, ["relayed"]);
        throw err;
    }
}

export async function scheduleRelay(item: RedditItem, approvalRetry: boolean) {
    const webhookUrl = await getStringSetting("webhook-url");
    const author = await item.getAuthor() as User | undefined;
    const itemType: ItemType = isCommentItem(item) ? "comment" : "post";
    const uniqueId = getUniqueId(item);
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
    const data: RelayPayload = {
        content: message,
        allowed_mentions: {
            parse: [
                "roles",
                "users",
                "everyone",
            ],
        },
    };
    if (delay === 0) {
        console.log(`Relaying event ${uniqueId}`);
        if (await getBooleanSetting("ignore-removed") && isRemoved(item)) {
            console.log(`Not relaying due to item removed: ${uniqueId}`);
            return;
        }
        await relay(item, webhookUrl, data);
    } else {
        const runAt = new Date(Date.now() + delay * 60 * 1000);
        console.log(`Scheduling relay (${uniqueId}) for ${delay} minutes from now (${runAt})`);
        if (await redis.hGet(item.id, "scheduled") === "true") {
            console.log(`Relay job already scheduled for ${uniqueId}`);
            return;
        }
        await scheduler.runJob({
            name: RELAY_SCHEDULED_JOB,
            data: {
                data,
                itemType,
                itemId: item.id,
                uniqueId,
                webhookUrl,
            },
            runAt,
        });
    }
    await redis.hSet(item.id, {scheduled: "true"});
}
