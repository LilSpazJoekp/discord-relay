import {reddit, redis} from "@devvit/web/server";

import type {ItemType, RedditItem} from "../types.js";
import {getDestinations, isBucketEnabled} from "./destinations.js";
import {buildModqueueMessage, getReportCount, getReportReasons} from "./messages.js";
import {relayToDestinations} from "./relay.js";
import {isCommentItem, getUniqueId} from "../utils/items.js";
import {splitCsv} from "../utils/flair.js";
import {asRecord, getDateString} from "../utils/records.js";
import {getBooleanSetting, getNumberSetting, getStringSetting} from "../utils/settings.js";

export async function scanModqueue() {
    if (!await isBucketEnabled("modqueue")) {
        return;
    }

    const modqueueDestinations = await getDestinations("modqueue");
    if (modqueueDestinations.length === 0) {
        return;
    }

    const subreddit = await reddit.getCurrentSubreddit();
    const contentType = await getStringSetting("modqueue-content-type", "all") as "all" | "post" | "comment";
    if (contentType === "post") {
        const items = await subreddit.getModQueue({type: "post"}).all();
        await processModqueueItems(items, modqueueDestinations);
        return;
    }
    if (contentType === "comment") {
        const items = await subreddit.getModQueue({type: "comment"}).all();
        await processModqueueItems(items, modqueueDestinations);
        return;
    }
    const items = await subreddit.getModQueue({type: "all"}).all();

    await processModqueueItems(items, modqueueDestinations);
}

async function processModqueueItems(items: RedditItem[], modqueueDestinations: Awaited<ReturnType<typeof getDestinations>>) {
    await Promise.all(items.map(async (item) => {
        if (!await shouldForwardModqueueItem(item)) {
            return;
        }
        const itemType: ItemType = isCommentItem(item) ? "comment" : "post";
        const uniqueId = getUniqueId(item);
        const seenKey = `modqueue:seen:${uniqueId}`;
        if (await redis.hGet(seenKey, "seen") === "true") {
            return;
        }

        const destinations = modqueueDestinations.filter((destination) => {
            return destination.events.includes("all")
                || destination.events.includes("modqueue")
                || destination.events.includes(itemType);
        });
        if (destinations.length === 0) {
            return;
        }
        await relayToDestinations({
            bucket: "modqueue",
            destinations,
            item,
            itemType,
            message: buildModqueueMessage(item),
            uniqueId,
        });
        await redis.hSet(seenKey, {seen: "true"});
    }));
}

async function shouldForwardModqueueItem(item: RedditItem) {
    if (getReportCount(item) < await getNumberSetting("modqueue-minimum-report-count")) {
        return false;
    }

    if (await getBooleanSetting("modqueue-only-mod-reported") && getReportReasons(item, "mod").length === 0) {
        return false;
    }

    const ageMinutes = getAgeMinutes(item);
    const minimumAge = await getNumberSetting("modqueue-minimum-age-minutes");
    const maximumAge = await getNumberSetting("modqueue-maximum-age-minutes");
    if (minimumAge > 0 && ageMinutes < minimumAge) {
        return false;
    }
    if (maximumAge > 0 && ageMinutes > maximumAge) {
        return false;
    }

    const reportContains = splitCsv(await getStringSetting("modqueue-report-contains"));
    if (reportContains.length > 0 && !containsAny(getReportReasons(item, "user").concat(getReportReasons(item, "mod")).join(" "), reportContains)) {
        return false;
    }

    const contentContains = splitCsv(await getStringSetting("modqueue-content-contains"));
    return !(contentContains.length > 0 && !containsAny(getContentText(item), contentContains));


}

function getAgeMinutes(item: RedditItem) {
    const createdAt = new Date(getDateString(asRecord(item).createdAt));
    return Math.max(0, (Date.now() - createdAt.getTime()) / 60_000);
}

function containsAny(value: string, keywords: string[]) {
    const normalized = value.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword));
}

function getContentText(item: RedditItem) {
    const record = asRecord(item);
    return [
        record.title,
        record.body,
    ].filter((value): value is string => typeof value === "string").join(" ");
}
