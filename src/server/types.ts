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

export type FlairLike = {
    text?: string | undefined;
    templateId?: string | undefined;
};

export type RelayPayload = JsonObject & {
    content: string;
    allowed_mentions: JsonObject & {
        parse: string[];
    };
};

export type RelayJobData = JsonObject & {
    data: RelayPayload;
    itemId: string;
    itemType: ItemType;
    uniqueId: string;
    webhookUrl: string;
};

export type ContentTriggerRequest =
    | OnCommentCreateRequest
    | OnCommentSubmitRequest
    | OnPostCreateRequest
    | OnPostSubmitRequest;

export type LifecycleTriggerRequest = OnAppInstallRequest | OnAppUpgradeRequest;
