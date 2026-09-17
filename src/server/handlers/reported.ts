import {reddit} from "@devvit/web/server";
import type {OnCommentReportRequest, OnPostReportRequest} from "@devvit/shared";

import type {ItemType, RedditItem} from "../types.js";
import {getDestinations, isBucketEnabled} from "../services/destinations.js";
import {buildReportedMessage, getReportCount, getReportReasons} from "../services/messages.js";
import {relayToDestinations} from "../services/relay.js";
import {getUniqueId} from "../utils/items.js";
import {asRecord, getString} from "../utils/records.js";
import {toCommentId, toPostId} from "../utils/redditIds.js";
import {getBooleanSetting, getNumberSetting, getStringSetting} from "../utils/settings.js";

export async function handleReportedTrigger(event: OnCommentReportRequest | OnPostReportRequest) {
    if (!await isBucketEnabled("reported")) {
        return;
    }

    const record = asRecord(event);
    const eventType = getString(record, "type");
    const itemType: ItemType = eventType === "CommentReport" ? "comment" : "post";
    const itemId = getReportedItemId(event, itemType);
    if (!itemId) {
        console.log(`Skipping ${eventType}: event did not include an item ID`);
        return;
    }
    const item = itemType === "comment"
        ? await reddit.getCommentById(toCommentId(itemId))
        : await reddit.getPostById(toPostId(itemId));

    if (!await shouldRelayReport(item)) {
        return;
    }

    const destinations = await getDestinations("reported", itemType);
    if (destinations.length === 0) {
        return;
    }

    await relayToDestinations({
        bucket: "reported",
        destinations,
        item,
        itemType,
        message: buildReportedMessage(item, event),
        uniqueId: getUniqueId(item),
    });
}

async function shouldRelayReport(item: RedditItem) {
    const modReportCount = getReportReasons(item, "mod").length;
    const userReportCount = getReportReasons(item, "user").length;
    const reportType = await getStringSetting("reported-report-type", "all");
    if (reportType === "mod-only" && modReportCount === 0) {
        return false;
    }
    if (reportType === "user-only" && userReportCount === 0) {
        return false;
    }
    if (modReportCount > 0 && await getBooleanSetting("reported-mod-reports-bypass-minimum")) {
        return true;
    }
    return getReportCount(item) >= await getNumberSetting("reported-minimum-report-count");
}

function getReportedItemId(event: unknown, itemType: ItemType) {
    const record = asRecord(event);
    const target = asRecord(itemType === "comment" ? record.comment : record.post);
    return getString(target, "id") || getString(record, itemType === "comment" ? "commentId" : "postId");
}
