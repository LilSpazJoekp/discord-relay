import {reddit, redis, type Subreddit} from "@devvit/web/server";

import type {FlairLike, ItemType, RedditItem} from "../types.js";
import {matchesFlair, matchesFlairTemplateId, normalize, splitCsv} from "../utils/flair.js";
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

    const userFlairMap = new Map<string, string>();
    const postFlairMap = new Map<string, string>();

    const ignoreUserFlair = await getStringSetting("ignore-user-flair");
    const ignoreUserFlairTemplateId = await getStringSetting("ignore-user-flair-template-id");
    const userFlair = await getStringSetting("user-flair");
    const userFlairTemplateId = await getStringSetting("user-flair-template-id");
    if (ignoreUserFlair || userFlair) {
        const userFlairs = await subreddit.getUserFlairTemplates();
        for (const flair of userFlairs) {
            userFlairMap.set(normalize(flair.id), normalize(flair.text));
        }
    }

    const ignorePostFlair = await getStringSetting("ignore-post-flair");
    const ignorePostFlairTemplateId = await getStringSetting("ignore-post-flair-template-id");
    const configuredPostFlair = await getStringSetting("post-flair");
    const postFlairTemplateId = await getStringSetting("post-flair-template-id");
    if (ignorePostFlair || configuredPostFlair) {
        const postFlairs = await subreddit.getPostFlairTemplates();
        for (const flair of postFlairs) {
            postFlairMap.set(normalize(flair.id), normalize(flair.text));
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
        const shouldIgnoreUserFlair = (ignoreUserFlair
            && matchesFlair(splitCsv(ignoreUserFlair), authorFlair, userFlairMap))
            || (ignoreUserFlairTemplateId
                && matchesFlairTemplateId(splitCsv(ignoreUserFlairTemplateId), authorFlair));
        if (shouldIgnoreUserFlair) {
            console.log("Should relay event (shouldRelayUserFlair): false");
            return false;
        }
        const shouldIgnorePostFlair = itemType === "post" && ((ignorePostFlair
            && matchesFlair(splitCsv(ignorePostFlair), postFlair, postFlairMap))
            || (ignorePostFlairTemplateId
                && matchesFlairTemplateId(splitCsv(ignorePostFlairTemplateId), postFlair)));
        if (shouldIgnorePostFlair) {
            console.log("Should relay event (shouldRelayPostFlair): false");
            return false;
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
        if (userFlair || userFlairTemplateId) {
            shouldRelayItem = Boolean((userFlair
                && matchesFlair(splitCsv(userFlair), authorFlair, userFlairMap))
                || (userFlairTemplateId
                    && matchesFlairTemplateId(splitCsv(userFlairTemplateId), authorFlair)));
            checks.push(shouldRelayItem);
        }
        if ((configuredPostFlair || postFlairTemplateId) && itemType === "post") {
            shouldRelayItem = Boolean((configuredPostFlair
                && matchesFlair(splitCsv(configuredPostFlair), postFlair, postFlairMap))
                || (postFlairTemplateId
                    && matchesFlairTemplateId(splitCsv(postFlairTemplateId), postFlair)));
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
