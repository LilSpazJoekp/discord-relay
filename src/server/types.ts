import type {Comment, Post} from "@devvit/web/server";
import type {
    JsonObject,
    OnAppInstallRequest,
    OnAppUpgradeRequest,
    OnCommentCreateRequest,
    OnCommentSubmitRequest,
    OnPostCreateRequest,
    OnPostSubmitRequest,
} from "@devvit/web/shared";

export type ItemType = "comment" | "post";
export type RedditItem = Comment | Post;
export type RelayBucket = "post" | "comment" | "modlog" | "modmail" | "modqueue" | "reported" | "unmoderated";
export type DestinationEvent = RelayBucket | "all";

export type RelayDestination = {
    id: string;
    webhookUrl: string;
    events: DestinationEvent[];
};

export type FlairLike = {
    text?: string | undefined;
    templateId?: string | undefined;
};

export type RelayEmbedField = {
    name: string;
    value: string;
    inline?: boolean;
    timestamp?: string;
};

export type RelayEmbed = {
    title: string;
    description?: string;
    url?: string;
    fields?: RelayEmbedField[];
    footer?: string;
    footerTimestamp?: string;
    timestamp?: string;
};

// Provider-formatted mentions, resolved per destination when the relay is sent or scheduled.
export type RelayMentions = JsonObject & {
    discord?: string[];
    slack?: string[];
};

// Prebuilt Slack Block Kit content. Sent to Slack in place of `content`/`embed`;
// Discord ignores it.
export type SlackMessage = JsonObject & {
    text: string;
    blocks: JsonObject[];
};

export type RelayMessage = JsonObject & {
    content?: string;
    embed?: RelayEmbed;
    mentions?: RelayMentions;
    slack?: SlackMessage;
};

export type RelayJobData = JsonObject & {
    bucket: RelayBucket;
    data?: RelayMessage;
    destinationId: string;
    message: RelayMessage;
    itemId: string;
    itemType: ItemType;
    trackingKey: string;
    uniqueId: string;
    webhookUrl: string;
};

export type ContentTriggerRequest =
    | OnCommentCreateRequest
    | OnCommentSubmitRequest
    | OnPostCreateRequest
    | OnPostSubmitRequest;

export type LifecycleTriggerRequest = OnAppInstallRequest | OnAppUpgradeRequest;
