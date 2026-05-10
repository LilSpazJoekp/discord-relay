import {ModAction} from "@devvit/protos";
import {
    Comment,
    Devvit,
    JobContext,
    Post,
    ScheduledJobEvent,
    SettingsFormFieldValidatorEvent,
    Subreddit,
    TriggerContext,
    User,
} from "@devvit/public-api";

const MINIMUM_DELAY = 3;
const RELAY_SCHEDULED_JOB = "relay";
const FRONT_PAGE_CHECK_SCHEDULED_JOB = "check-front-page";

Devvit.configure({
    http: true,
    redditAPI: true,
    redis: true,
});

function isRemoved(target: Comment | Post) {
    console.log(`isRemoved attrs ${JSON.stringify(target, null, 2)}`);
    return target.spam
        || target.removed
        // @ts-ignore
        || target.removedByCategory
        === "automod_filtered"
        // @ts-ignore
        || target.bannedBy
        === "AutoModerator"
        // @ts-ignore
        || target.bannedBy?.toString()
        === "true"
        // @ts-ignore
        || target.removalReason
        === "legal";
}

async function isShadowBanned(context: TriggerContext, target: Comment | Post) {
    return !(
        await context.reddit.getUserById(target.authorId || "")
    );
}

Devvit.addSchedulerJob({
    name: RELAY_SCHEDULED_JOB,
    onRun: async (event: ScheduledJobEvent<any>, context: JobContext) => {
        const {reddit, settings} = context;
        const {
            data,
            itemId,
            itemType,
            uniqueId,
            webhookUrl,
        } = event.data!;
        let item;
        item = itemType === "post" ? await reddit.getPostById(itemId) : await reddit.getCommentById(itemId);
        if (await settings.get("ignore-removed") && isRemoved(item)) {
            console.log(`Not relaying due to item removed: ${uniqueId}`);
            return;
        }
        console.log(`Relaying event ${uniqueId}`);
        await relay(context, item, webhookUrl, data);
    },
});

Devvit.addSchedulerJob({
    name: FRONT_PAGE_CHECK_SCHEDULED_JOB,
    onRun: async (event, context) => {
        const {reddit, redis, settings} = context;
        const relayMode: string[] = await settings.get("relay-mode") || ["immediately"];
        if (relayMode[0] !== "front-page") {
            return;
        }
        console.log("Checking front page");
        const subreddit = await reddit.getCurrentSubreddit();
        const posts = await subreddit.getTopPosts({limit: 100}).all();
        console.log(`Checking ${posts.length} posts`);
        posts.map(async (post) => {
            const shouldRelayItem = await shouldRelay({type: "FrontPageCheck", post}, context);
            await redis.hSet(post.id, {shouldRelay: shouldRelayItem.toString()});
            if (shouldRelayItem) {
                await scheduleRelay(context, post, false);
            }
        });
    },
});

Devvit.addSettings([
    {
        label: "Discord Webhook URL",
        name: "webhook-url",
        onValidate: (event) => {
            if (event.value!.length == 0) {
                return "Please enter a webhook URL";
            }
        },
        type: "string",
    },
    {
        helpText: "Determines when items are relayed to Discord. If set to 'immediately', items are relayed as soon as they are created. If set to 'front page', items are relayed when they reach the front page of the subreddit.",
        fields: [
            {
                defaultValue: ["immediately"],
                helpText: "Choose when to relay items to Discord.",
                label: "Relay Mode",
                multiSelect: false,
                name: "relay-mode",
                options: [
                    {
                        label: "Immediately",
                        value: "immediately",
                    },
                    {
                        label: "Front Page",
                        value: "front-page",
                    },
                ],
                type: "select",
            },
            {
                defaultValue: ["hour"],
                helpText: "Choose the time frame for the front page relay mode. Has no effect if relay mode is set to 'immediately'.",
                label: "Front Page Time Frame",
                multiSelect: false,
                name: "front-page-time-frame",
                options: [
                    {
                        label: "Hour",
                        value: "hour",
                    },
                    {
                        label: "Day",
                        value: "day",
                    },
                    {
                        label: "Week",
                        value: "week",
                    },
                    {
                        label: "Month",
                        value: "month",
                    },
                    {
                        label: "Year",
                        value: "year",
                    },
                    {
                        label: "All",
                        value: "all",
                    },
                ],
                type: "select",
            },
        ],
        label: "Relay Mode Settings",
        type: "group",
    },
    {
        fields: [
            {
                label: "Ping a role?",
                name: "ping-role",
                type: "boolean",
            },
            {
                label: "Role ID",
                name: "ping-role-id",
                type: "string",
            },
        ],
        helpText: "If enabled, a role will be pinged when a new comment or post is relayed to Discord.",
        label: "Role Ping settings",
        type: "group",
    },
    {
        fields: [
            {
                defaultValue: ["post"],
                helpText: "Type of content to relay to Discord",
                label: "Content Type",
                multiSelect: false,
                name: "content-type",
                options: [
                    {
                        label: "All",
                        value: "all",
                    },
                    {
                        label: "Posts Only",
                        value: "post",
                    },
                    {
                        label: "Comments Only",
                        value: "comment",
                    },
                ],
                type: "select",
            },
            {
                fields: [
                    {
                        helpText: "Only relay items from specific users or moderators. Username (without the \"u/\") or enter \"m\" for all moderators. Separate each item with a comma to include multiple users",
                        label: "Username(s)/Moderators Only",
                        name: "specific-username",
                        type: "string",
                    },
                    {
                        helpText: "User flair text to match against. Separate each item with a comma to include multiple flairs.",
                        label: "User Flair Text",
                        name: "user-flair",
                        type: "string",
                    },
                    {
                        helpText: "Post flair text to match against. Separate each item with a comma to include multiple flairs.",
                        label: "Post Flair Text",
                        name: "post-flair",
                        type: "string",
                    },
                    {
                        helpText: "If enabled, only authors that are also Approved Users can relay. This check is in addition to other checks.",
                        label: "Only Approved Authors",
                        name: "only-approved-users",
                        type: "boolean",
                        defaultValue: false,
                    },
                ],
                helpText: "Relay items by username(s)/moderators or post/user flairs. If any of these settings match, the item will be relayed.",
                label: "Inclusion Filters",
                type: "group",
            },
            {
                fields: [
                    {
                        helpText: "Ignore items from specific users or moderators. Username (without the \"u/\") or enter \"m\" for all moderators. Separate each item with a comma to include multiple users.",
                        label: "Username(s)/Moderators Only",
                        name: "ignore-specific-username",
                        type: "string",
                    },
                    {
                        helpText: "User flair text to ignore. Separate each item with a comma to include multiple flairs.",
                        label: "User Flair Text",
                        name: "ignore-user-flair",
                        type: "string",
                    },
                    {
                        helpText: "Post flair text to ignore. Separate each item with a comma to include multiple flairs.",
                        label: "Post Flair Text",
                        name: "ignore-post-flair",
                        type: "string",
                    },
                    {
                        helpText: "If enabled, authors that deleted their account or is shadowbanned will not be relayed.",
                        label: "Ignore Shadowbanned or Deleted Authors",
                        name: "ignore-shadowbanned",
                        type: "boolean",
                        defaultValue: false,
                    },
                ],
                helpText: "Ignore by username(s)/moderators or post/user flairs. Takes precedence over all other settings. If any of these settings match, the item will not be relayed.",
                label: "Exclusion Filters",
                type: "group",
            },
        ],
        helpText: "Filter items to relay to Discord based on specific criteria.",
        label: "Filtering Settings",
        type: "group",
    },
    {
        fields: [
            {
                defaultValue: 0,
                helpText: `Number of minutes to delay relaying comments to Discord. Enter 0 to disable the delay. Must be at least ${MINIMUM_DELAY} minutes.`,
                label: "Comment Delay (in minutes)",
                name: "comment-delay",
                onValidate: validateDelay,
                type: "number",
            },
            {
                defaultValue: 0,
                helpText: `Number of minutes to delay relaying posts to Discord. Enter 0 to disable the delay. Must be at least ${MINIMUM_DELAY} minutes.`,
                label: "Post Delay (in minutes)",
                name: "post-delay",
                onValidate: validateDelay,
                type: "number",
            },
            {
                helpText: "If enabled, items will not be relayed if they are removed.",
                label: "Ignore Removed Items",
                name: "ignore-removed",
                type: "boolean",
            },
            {
                helpText: "If enabled, items that are later approved will be relayed. This will also relay any item that is approved.",
                label: "Retry On Approval",
                name: "retry-on-approval",
                type: "boolean",
            },
            {
                defaultValue: 0,
                helpText: `Number of minutes to delay relaying comments to Discord after approval. Enter 0 to disable the delay. Must be at least ${MINIMUM_DELAY} minutes.`,
                label: "Comment Delay After Approval (in minutes)",
                name: "comment-delay-after-approval",
                onValidate: validateDelay,
                type: "number",
            },
            {
                defaultValue: 0,
                helpText: `Number of minutes to delay relaying posts to Discord after approval. Enter 0 to disable the delay. Must be at least ${MINIMUM_DELAY} minutes.`,
                label: "Post Delay After Approval (in minutes)",
                name: "post-delay-after-approval",
                onValidate: validateDelay,
                type: "number",
            },
            {
                defaultValue: 0,
                helpText: `Score threshold to relay posts to Discord. Ignored if relay mode is set to 'immediately'. Enter 0 to relay when the post appears on the sub's front page.`,
                label: "Post score threshold",
                name: "post-score-threshold",
                type: "number",
            },
            {
                helpText: "If enabled, skip built-in Reddit safety checks and relay the item to Discord. Useful for moderation feeds.",
                label: "Skip Reddit Safety Checks",
                name: "skip-safety-checks",
                type: "boolean",
            },
        ],
        helpText: "Delay relaying to Discord for a set amount of time after the item is created to allow for moderation.",
        label: "Delay Settings",
        type: "group",
    },
    {
        defaultValue: false,
        helpText: "If enabled, the embed of the comment/post like being relayed will be suppressed.",
        label: "Suppress comment/post embeds?",
        name: "suppress-item-embed",
        type: "boolean",
    },
    {
        defaultValue: false,
        helpText: "If enabled, the embed of the author will be suppressed. Profiles do not have embeds shown unless they are NSFW.",
        label: "Suppress NSFW author embeds?",
        name: "suppress-author-embed",
        type: "boolean",
    },
]);

Devvit.addTrigger({
    events: ["AppUpgrade", "AppInstall"],
    onEvent: async function (event: any, context: TriggerContext) {
        const {scheduler} = context;
        await scheduler.listJobs()
            .then(jobs => jobs.filter(job => job.name === FRONT_PAGE_CHECK_SCHEDULED_JOB)
                .map(async job => await scheduler.cancelJob(job.id)),
            );
        await scheduler.runJob({
            name: FRONT_PAGE_CHECK_SCHEDULED_JOB,
            cron: "* * * * *",
        });
    },
});

Devvit.addTrigger({
    events: ["CommentCreate", "PostCreate", "CommentSubmit", "PostSubmit"],
    onEvent: async function (
        event: any,
        context: TriggerContext,
    ) {
        const {reddit, redis, settings} = context;
        const skipSafetyChecks = await settings.get("skip-safety-checks");
        if ((
            event.type === "CommentSubmit" || event.type === "PostSubmit"
        ) === !skipSafetyChecks) {
            console.log(`${skipSafetyChecks ? "Skipping" : "Waiting for"} safety checks`);
            return;
        }
        const relayMode: string[] = await settings.get("relay-mode") || ["immediately"];
        if (relayMode[0] === "front-page") {
            return;
        }
        const uniqueId = (
            event.type === "CommentCreate"
        ) || (
            event.type === "CommentSubmit"
        )
            ? `${event.comment.parentId}/${event.comment.id}`
            : event.post.id;
        const item = (
            event.type === "CommentCreate"
        ) || (
            event.type === "CommentSubmit"
        )
            ? await reddit.getCommentById(event.comment.id)
            : await reddit.getPostById(event.post.id);
        console.log(`Received ${event.type} event (${uniqueId}) by u/${item.authorName}`);
        const shouldRelayItem = await shouldRelay(event, context);
        await redis.hSet(item.id, {shouldRelay: shouldRelayItem.toString()});
        if (shouldRelayItem) {
            await scheduleRelay(context, item, false);
        }
    },
});

Devvit.addTrigger({
    events: ["ModAction"],
    onEvent: async function (event: ModAction, context: TriggerContext) {
        const {reddit, redis, settings} = context;
        if ((
            event.action != "approvelink" && event.action != "approvecomment"
        )) {
            return;
        }
        const retryOnApproval = await settings.get("retry-on-approval");
        if (!retryOnApproval) {
            return;
        }
        let target: Comment | Post;
        let uniqueId: string;
        if (event.action == "approvelink") {
            target = await reddit.getPostById(event.targetPost?.id || "");
            uniqueId = target.id;
        } else {
            target = await reddit.getCommentById(event.targetComment?.id || "");
            uniqueId = `${target.parentId}/${target.id}`;
        }
        console.log(`Received ${event.action} mod action (${uniqueId})`);
        const shouldRelayItem = await redis.hGet(target.id, "shouldRelay") === "true";
        const wasRelayed = await redis.hGet(target.id, "relayed") === "true";
        if (shouldRelayItem && !wasRelayed) {
            await scheduleRelay(context, target, true);
        } else {
            console.log(`Not relaying ${event.action} mod action (${uniqueId}) due to shouldRelayItem: ${shouldRelayItem} and wasRelayed: ${wasRelayed}`);
        }
    },
});

async function relay(
    context: TriggerContext,
    item: Comment | Post,
    webhookUrl: string,
    data: { allowed_mentions: { parse: string[] }; content: string },
) {
    // Atomically claim "relayed" before firing the webhook to prevent
    // duplicate relays in case multiple events are fired for the same item.
    const claimed = await context.redis.hSetNX(item.id, "relayed", "true");
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
        // Webhook fetch failed (e.g. network error). Roll back the claim so
        // that the retry-on-approval path can attempt again.
        await context.redis.hDel(item.id, ["relayed"]);
        throw err;
    }
}

async function scheduleRelay(context: TriggerContext, item: Comment | Post, approvalRetry: boolean) {
    const {
        redis,
        settings,
    } = context;
    const webhookUrl = (
        await settings.get("webhook-url")
    )!.toString();
    const {url: authorUrl, username} = await item.getAuthor() as User;
    const itemType = item instanceof Comment ? "comment" : "post";
    const uniqueId = item instanceof Comment ? `${item.parentId}/${item.id}` : item.id;
    const delayKey = `${itemType}-delay`;
    let delay: number = await settings.get(delayKey + (
        approvalRetry ? "-after-approval" : ""
    )) || 0;
    let suppressAuthorEmbed = await settings.get("suppress-author-embed") || false;
    let suppressItemEmbed = await settings.get("suppress-item-embed") || false;
    let message = `New [${itemType}](${suppressItemEmbed
        ? "<"
        : ""}https://www.reddit.com${item.permalink}${suppressItemEmbed
        ? ">"
        : ""}) by [u/${username}](${suppressAuthorEmbed ? "<" : ""}${authorUrl}${suppressAuthorEmbed ? ">" : ""})!`;
    if (await settings.get("ping-role")) {
        const roleId = await settings.get("ping-role-id");
        message = `${message}\n<@&${roleId}>`;
    }
    const data = {
        content: message,
        "allowed_mentions": {
            "parse": [
                "roles",
                "users",
                "everyone",
            ],
        },
    };
    if (delay == 0) {
        console.log(`Relaying event ${uniqueId}`);
        if (await settings.get("ignore-removed") && isRemoved(item)) {
            console.log(`Not relaying due to item removed: ${uniqueId}`);
            return;
        }
        await relay(context, item, webhookUrl, data);
    } else {
        const runAt = new Date(Date.now() + delay * 60 * 1000);
        console.log(`Scheduling relay (${uniqueId}) for ${delay} minutes from now (${runAt})`);
        if (await redis.hGet(item.id, "scheduled") === "true") {
            console.log(`Relay job already scheduled for ${uniqueId}`);
            return;
        }
        await context.scheduler.runJob({
            name: RELAY_SCHEDULED_JOB,
            data: {
                data,
                itemType,
                itemId: item.id,
                uniqueId,
                webhookUrl,
            },
            runAt: runAt,
        });
    }
    await redis.hSet(item.id, {scheduled: "true"});
}

async function shouldRelay(event: any, context: TriggerContext): Promise<boolean> {
    let itemType: string;
    let item: Post | Comment;
    let authorName: string;
    switch (event.type) {
        case "PostCreate":
            item = event.post;
            itemType = "post";
            authorName = event.author.name;
            break;
        case "CommentCreate":
            item = event.comment;
            itemType = "comment";
            authorName = event.author.name;
            break;
        case "PostSubmit":
            item = event.post;
            itemType = "post";
            authorName = event.author.name;
            break;
        case "CommentSubmit":
            item = event.comment;
            itemType = "comment";
            authorName = event.author.name;
            break;
        default:
            item = event.post;
            itemType = "post";
            authorName = item.authorName;
            break;
    }
    console.log(`Checking if we should relay event (${item instanceof Comment
        ? `${item.parentId}/${item.id}`
        : item.id})`);
    const {
        reddit,
        redis,
        settings,
    } = context;

    const subreddit: Subreddit = await reddit.getCurrentSubreddit();

    const flairMap = new Map<string, string>();

    const ignoreUserFlair: string = await settings.get("ignore-user-flair") || "";
    const userFlair: string = await settings.get("user-flair") || "";
    if (ignoreUserFlair || userFlair) {
        const userFlairs = (
            await subreddit.getUserFlairTemplates()
        );
        for (const flair of userFlairs) {
            flairMap.set(flair.id, flair.text);
        }
    }

    const ignorePostFlair: string = await settings.get("ignore-post-flair") || "";
    const postFlair: string = await settings.get("post-flair") || "";
    if (ignorePostFlair || postFlair) {
        const postFlairs = await subreddit.getPostFlairTemplates();
        for (const flair of postFlairs) {
            flairMap.set(flair.id, flair.text);
        }
    }

    const contentType = await settings.get("content-type");
    const relayMode: string[] = await settings.get("relay-mode") || ["immediately"];

    let shouldRelay = contentType == "all" || contentType == itemType;
    shouldRelay = shouldRelay && !(
        await redis.hGet(item.id, "relayed") === "true"
    );

    const ignoreShadowBanned: boolean = await settings.get("ignore-shadowbanned") || false;
    const approvedUsersOnly = await settings.get("only-approved-users") || false;

    let checks: boolean[] = [];
    if (shouldRelay) {
        if (ignoreShadowBanned && await isShadowBanned(context, item)) {
            console.log(`Should relay event (ignoreShadowBanned): false`);
            return false;
        }
        if (approvedUsersOnly) {
            const approvedUsers = await subreddit.getApprovedUsers({username: authorName}).all();
            if (!approvedUsers.map((item) => item.username.toLowerCase()).includes(authorName.toLowerCase())) {
                console.log(`Should relay event (approvedUsersOnly): false`);
                return false;
            }
        }
        const ignoreUsername: string = await settings.get("ignore-specific-username") || "";
        if (ignoreUsername) {
            let shouldRelayUserIgnore: boolean;
            const ignoreUsernames = ignoreUsername.toLowerCase()
                .split(",")
                .map(name => name.trim())
                .filter(name => name.length > 0);
            shouldRelayUserIgnore = !ignoreUsernames.includes(authorName.toLowerCase());
            if (shouldRelayUserIgnore && ignoreUsernames.includes("m")) {
                shouldRelayUserIgnore = (
                    await subreddit.getModerators({username: authorName}).all()
                ).length == 0;
            }
            if (!shouldRelayUserIgnore) {
                console.log(`Should relay event (shouldRelayUserIgnore): ${shouldRelayUserIgnore}`);
                return false;
            }
        }
        if (ignoreUserFlair) {
            let shouldRelayUserFlair: boolean;
            const ignoreUserFlairs = ignoreUserFlair.toLowerCase()
                .split(",")
                .map(flair => flair.trim())
                .filter(flair => flair.length > 0);
            shouldRelayUserFlair = !(
                ignoreUserFlairs.includes(event.author.flair.text.toLowerCase())
                || ignoreUserFlairs.includes(flairMap.get(event.author.flair.templateId) || "")
            );
            if (!shouldRelayUserFlair) {
                console.log(`Should relay event (shouldRelayUserFlair): ${shouldRelayUserFlair}`);
                return false;
            }
        }
        if (ignorePostFlair && itemType === "post") {
            let shouldRelayPostFlair: boolean;
            const ignorePostFlairs = ignorePostFlair.toLowerCase()
                .split(",")
                .map(flair => flair.trim())
                .filter(flair => flair.length > 0);
            shouldRelayPostFlair = !(
                ignorePostFlairs.includes(event.post.linkFlair.text.toLowerCase())
                || ignorePostFlairs.includes(flairMap.get(event.post.linkFlair.templateId
                    || "") || "")
            );
            if (!shouldRelayPostFlair) {
                console.log(`Should relay event (shouldRelayPostFlair): ${shouldRelayPostFlair}`);
                return false;
            }
        }
        const username: string = await settings.get("specific-username") || "";
        if (username) {
            const usernames = username.toLowerCase()
                .split(",")
                .map(name => name.trim())
                .filter(name => name.length > 0);
            shouldRelay = usernames.includes(authorName.toLowerCase());
            if (!shouldRelay && usernames.includes("m")) {
                shouldRelay = (
                    await subreddit.getModerators({username: authorName}).all()
                ).length > 0;
            }
            checks.push(shouldRelay);
        }
        if (userFlair) {
            const userFlairs = userFlair.toLowerCase()
                .split(",")
                .map(flair => flair.trim())
                .filter(flair => flair.length > 0);
            shouldRelay = userFlairs.includes(event.author.flair.text.toLowerCase())
                || userFlairs.includes(flairMap.get(event.author.flair.templateId) || "");
            checks.push(shouldRelay);
        }
        if (postFlair && itemType === "post") {
            const postFlairs = postFlair.toLowerCase()
                .split(",")
                .map(flair => flair.trim())
                .filter(flair => flair.length > 0);
            shouldRelay = postFlairs.includes(event.post.linkFlair.text
                    ? event.post.linkFlair.text.toLowerCase() : "")
                || postFlairs.includes(flairMap.get(event.post.linkFlair?.templateId
                    || "") || "");
            checks.push(shouldRelay);
        }
        if (relayMode[0] === "front-page") {
            const postScoreThreshold = await settings.get("post-score-threshold") || 0;
            if (item instanceof Post) {
                shouldRelay = item.score >= (
                    postScoreThreshold as number
                );
            }
        }
    }
    if (checks.length == 0) {
        console.log(`Should relay event: ${shouldRelay}`);
        return shouldRelay;
    }
    shouldRelay = checks.includes(true);
    console.log(`Should relay event: ${shouldRelay}`);
    return shouldRelay;
}

function validateDelay(event: SettingsFormFieldValidatorEvent<number>) {
    const inputValue = event.value || 0;
    if (inputValue != 0 && inputValue < MINIMUM_DELAY) {
        return `Please enter a delay of at least ${MINIMUM_DELAY} minutes`;
    }
}

// noinspection JSUnusedGlobalSymbols
// @ts-ignore
export default Devvit;
