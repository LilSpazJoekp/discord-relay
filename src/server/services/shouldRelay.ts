import {reddit, redis, type Subreddit} from "@devvit/web/server";

import type {FlairLike, ItemType, RedditItem} from "../types.js";
import {matchesFlair, normalize, splitCsv} from "../utils/flair.js";
import {getUniqueId, isPostItem} from "../utils/items.js";
import {toUserId} from "../utils/redditIds.js";
import {getBooleanSetting, getNumberSetting, getStringSetting} from "../utils/settings.js";

export async function shouldRelay(
    {
        item,
        itemType,
        authorName,
        authorFlair,
        postFlair,
    }: {
        item: RedditItem;
        itemType: ItemType;
        authorName: string;
        authorFlair?: FlairLike | undefined;
        postFlair?: FlairLike | undefined;
    }): Promise<boolean> {
    console.log(`Checking if we should relay event (${getUniqueId(item)})`);

    const subreddit: Subreddit = await reddit.getCurrentSubreddit();

    const flairMap = new Map<string, string>();

    const ignoreUserFlair = await getStringSetting("ignore-user-flair");
    const userFlair = await getStringSetting("user-flair");
    if (ignoreUserFlair || userFlair) {
        const userFlairs = await subreddit.getUserFlairTemplates();
        for (const flair of userFlairs) {
            flairMap.set(flair.id, normalize(flair.text));
        }
    }

    const ignorePostFlair = await getStringSetting("ignore-post-flair");
    const configuredPostFlair = await getStringSetting("post-flair");
    if (ignorePostFlair || configuredPostFlair) {
        const postFlairs = await subreddit.getPostFlairTemplates();
        for (const flair of postFlairs) {
            flairMap.set(flair.id, normalize(flair.text));
        }
    }

    const contentType = await getStringSetting("content-type", "post");
    const relayMode = await getStringSetting("relay-mode", "immediately");

    let shouldRelayItem = contentType === "all" || contentType === itemType;
    shouldRelayItem = shouldRelayItem && await redis.hGet(item.id, "relayed") !== "true";

    const ignoreShadowBanned = await getBooleanSetting("ignore-shadowbanned");
    const approvedUsersOnly = await getBooleanSetting("only-approved-users");

    const checks: boolean[] = [];
    if (shouldRelayItem) {
        if (ignoreShadowBanned && await isShadowBanned(item)) {
            console.log("Should relay event (ignoreShadowBanned): false");
            return false;
        }
        if (approvedUsersOnly) {
            const approvedUsers = await subreddit.getApprovedUsers({username: authorName}).all();
            if (!approvedUsers.map((approvedUser) => approvedUser.username.toLowerCase()).includes(authorName.toLowerCase())) {
                console.log("Should relay event (approvedUsersOnly): false");
                return false;
            }
        }
        const ignoreUsername = await getStringSetting("ignore-specific-username");
        if (ignoreUsername) {
            let shouldRelayUserIgnore: boolean;
            const ignoreUsernames = splitCsv(ignoreUsername);
            shouldRelayUserIgnore = !ignoreUsernames.includes(authorName.toLowerCase());
            if (shouldRelayUserIgnore && ignoreUsernames.includes("m")) {
                shouldRelayUserIgnore = (
                    await subreddit.getModerators({username: authorName}).all()
                ).length === 0;
            }
            if (!shouldRelayUserIgnore) {
                console.log(`Should relay event (shouldRelayUserIgnore): ${shouldRelayUserIgnore}`);
                return false;
            }
        }
        if (ignoreUserFlair) {
            let shouldRelayUserFlair: boolean;
            const ignoreUserFlairs = splitCsv(ignoreUserFlair);
            shouldRelayUserFlair = !matchesFlair(ignoreUserFlairs, authorFlair, flairMap);
            if (!shouldRelayUserFlair) {
                console.log(`Should relay event (shouldRelayUserFlair): ${shouldRelayUserFlair}`);
                return false;
            }
        }
        if (ignorePostFlair && itemType === "post") {
            let shouldRelayPostFlair: boolean;
            const ignorePostFlairs = splitCsv(ignorePostFlair);
            shouldRelayPostFlair = !matchesFlair(ignorePostFlairs, postFlair, flairMap);
            if (!shouldRelayPostFlair) {
                console.log(`Should relay event (shouldRelayPostFlair): ${shouldRelayPostFlair}`);
                return false;
            }
        }
        const username = await getStringSetting("specific-username");
        if (username) {
            const usernames = splitCsv(username);
            shouldRelayItem = usernames.includes(authorName.toLowerCase());
            if (!shouldRelayItem && usernames.includes("m")) {
                shouldRelayItem = (
                    await subreddit.getModerators({username: authorName}).all()
                ).length > 0;
            }
            checks.push(shouldRelayItem);
        }
        if (userFlair) {
            const userFlairs = splitCsv(userFlair);
            shouldRelayItem = matchesFlair(userFlairs, authorFlair, flairMap);
            checks.push(shouldRelayItem);
        }
        if (configuredPostFlair && itemType === "post") {
            const postFlairs = splitCsv(configuredPostFlair);
            shouldRelayItem = matchesFlair(postFlairs, postFlair, flairMap);
            checks.push(shouldRelayItem);
        }
        if (relayMode === "front-page") {
            const postScoreThreshold = await getNumberSetting("post-score-threshold");
            if (isPostItem(item)) {
                shouldRelayItem = item.score >= postScoreThreshold;
            }
        }
    }
    if (checks.length === 0) {
        console.log(`Should relay event: ${shouldRelayItem}`);
        return shouldRelayItem;
    }
    shouldRelayItem = checks.includes(true);
    console.log(`Should relay event: ${shouldRelayItem}`);
    return shouldRelayItem;
}

async function isShadowBanned(target: RedditItem) {
    if (!target.authorId) {
        return true;
    }
    return !(await reddit.getUserById(toUserId(target.authorId)));
}
