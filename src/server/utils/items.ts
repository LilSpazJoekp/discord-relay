import type {Comment, Post} from "@devvit/web/server";

import type {RedditItem} from "../types.js";

export function isRemoved(target: RedditItem) {
    console.log(`isRemoved attrs ${JSON.stringify(target, null, 2)}`);
    const removedByCategory = "removedByCategory" in target ? target.removedByCategory : undefined;
    const removedBy = "removedBy" in target ? target.removedBy : undefined;
    const removalReason = (target as unknown as { removalReason?: string }).removalReason;
    return target.spam
        || target.removed
        || removedByCategory === "automod_filtered"
        || removedBy === "AutoModerator"
        || removedBy?.toString() === "true"
        || removalReason === "legal";
}

export function isCommentItem(item: RedditItem): item is Comment {
    return "parentId" in item;
}

export function isPostItem(item: RedditItem): item is Post {
    return !isCommentItem(item);
}

export function getUniqueId(item: RedditItem) {
    return isCommentItem(item) ? `${item.parentId}/${item.id}` : item.id;
}
