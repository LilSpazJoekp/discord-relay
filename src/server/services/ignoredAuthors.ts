import {reddit} from "@devvit/web/server";

import {splitCsv} from "../utils/flair.js";
import {getStringSetting} from "../utils/settings.js";

const MODERATOR_TOKEN = "m";

export async function isIgnoredAuthor(
    authorName: string | undefined,
    {
        additionalSettingName,
        isModerator,
        matchModeratorToken = true,
    }: {
        /** A bucket-specific ignore list, merged with the global one. */
        additionalSettingName?: string;
        /** Known moderator status, when the event already carries it. */
        isModerator?: boolean;
        /** Whether the `m` token applies to this bucket. */
        matchModeratorToken?: boolean;
    } = {},
): Promise<boolean> {
    const username = stripUserPrefix((authorName || "").toLowerCase());
    if (!username) {
        return false;
    }

    const ignored = [
        await getStringSetting("global-ignore-usernames"),
        additionalSettingName ? await getStringSetting(additionalSettingName) : "",
    ].flatMap((value) => splitCsv(value)).map(stripUserPrefix);
    if (ignored.length === 0) {
        return false;
    }
    if (ignored.includes(username)) {
        return true;
    }
    if (!matchModeratorToken || !ignored.includes(MODERATOR_TOKEN)) {
        return false;
    }
    if (isModerator) {
        return true;
    }
    // Events do not always carry a reliable author type, so confirm against the
    // moderator list rather than trusting its absence.
    return isSubredditModerator(username);
}

async function isSubredditModerator(username: string) {
    try {
        const subreddit = await reddit.getCurrentSubreddit();
        return (await subreddit.getModerators({username}).all()).length > 0;
    } catch (err) {
        console.log(`Failed to check moderator status for ${username}: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

// Accepts "name", "u/name" and "/u/name" so the setting behaves the way mods write it.
function stripUserPrefix(value: string) {
    return value.trim().replace(/^\/?u\//, "");
}
