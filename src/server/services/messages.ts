import type {RedditItem, RelayEmbedField, RelayMessage} from "../types.js";
import {REDDIT_THING_ID_PREFIX_PATTERN} from "../constants.js";
import {isCommentItem} from "../utils/items.js";
import {asRecord, getDateString, getNumber, getString, stringifyValue, type UnknownRecord} from "../utils/records.js";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
});

const REDDIT_ADMIN_MODERATOR_NAMES = new Set([
    "Anti-Evil Operations",
    "Reddit Legal",
    "[ redacted ]",
]);

export function buildModActionMessage(event: unknown): RelayMessage {
    const record = asRecord(event);
    const fields = Object.entries(record)
        .filter(([key]) => key !== "type")
        .map(([key, value]) => toEmbedField(labelize(key), formatModActionValue(key, value), dateTimestamp(key, value)))
        .filter((field) => field.value.length > 0);
    const modlogUrl = getModlogUrl(record);
    if (modlogUrl) {
        fields.push(toEmbedField("Modlog", formatMarkdownLink("View Modlog", modlogUrl)));
    }

    return {
        embed: {
            title: "Mod Action",
            fields,
            ...timestampFooter(),
            timestamp: getDateString(record.actionedAt ?? record.createdAt ?? record.createdUtc ?? record.created_utc),
        },
    };
}

export function buildModmailMessage(event: unknown): RelayMessage {
    const record = asRecord(event);
    const conversation = asRecord(record.conversation);
    const message = asRecord(record.message);
    const author = asRecord(message.author ?? record.author ?? record.messageAuthor);
    const body = getString(message, "bodyMarkdown")
        || getString(record, "bodyMarkdown")
        || getString(message, "body")
        || getString(message, "bodyText")
        || getString(message, "text")
        || getString(message, "message")
        || getString(record, "body")
        || getString(record, "message");
    const authorName = getString(author, "name") || getString(author, "username") || getString(record, "author") || getString(record, "messageAuthor");
    const authorType = getString(message, "participatingAs")
        || getString(author, "type")
        || getString(record, "authorType")
        || getString(record, "messageAuthorType");
    const subject = getString(conversation, "subject") || getString(record, "subject");
    const title = getString(conversation, "title") || getString(record, "title") || subject;
    const conversationId = getString(conversation, "id") || getString(record, "conversationId") || getString(record, "conversation_id");
    const messageId = getString(message, "id") || getString(record, "messageId") || getString(record, "message_id");
    const isFirstMessage = getBooleanish(record.isNew) || getBooleanish(record.isNewThread) || getNumber(conversation, "numMessages") <= 1;

    return {
        embed: {
            title: isFirstMessage ? "New Modmail" : "Modmail Reply",
            fields: [
                toEmbedField("Author Type", formatModmailAuthorType(authorType)),
                toEmbedField("Author", formatModmailAuthor(authorName)),
                toEmbedField("Title", title),
                toEmbedField("Subject", subject),
                toEmbedField("Message", formatModmailBody(body)),
                toEmbedField("Link to Modmail Message", formatModmailLink(conversationId, messageId)),
                toEmbedField(
                    "Originating Modmail Timestamp",
                    formatDateValue(conversation.createdAt ?? conversation.createdUtc),
                    dateTimestamp("createdAt", conversation.createdAt ?? conversation.createdUtc),
                ),
            ].filter((field) => field.value.length > 0),
            ...timestampFooter(),
            timestamp: getDateString(message.createdAt ?? message.createdUtc ?? message.date ?? record.createdAt ?? record.createdUtc),
        },
    };
}

export function buildModqueueMessage(item: RedditItem): RelayMessage {
    const itemType = isCommentItem(item) ? "Comment" : "Post";

    return {
        embed: {
            title: `New Modqueue ${itemType}`,
            fields: [
                toEmbedField("Item Type", itemType),
                toEmbedField("Link to content", formatMaybeLink(redditUrl(item.permalink))),
                toEmbedField("User Reports", formatUserReports(item)),
                toEmbedField("Mod Reports", formatModReports(item)),
            ].filter((field) => field.value.length > 0),
            ...timestampFooter(),
            timestamp: new Date().toISOString(),
        },
    };
}

export function buildReportedMessage(item: RedditItem, event?: unknown): RelayMessage {
    const record = asRecord(event);
    const modReports = getReportReasons(item, "mod").length > 0;
    const reportBody = getString(record, "reason") || getString(record, "reportReason") || getReportReasons(item, modReports ? "mod" : "user").join("\n");

    return {
        embed: {
            title: modReports ? "New Mod Report" : "New Report",
            fields: [
                toEmbedField("Link to content", formatMaybeLink(redditUrl(item.permalink))),
                toEmbedField("Report body", reportBody),
                toEmbedField("Report count", getReportCount(item).toString()),
                toEmbedField("Reporter", getString(record, "reporter") || getString(record, "reporterName")),
            ].filter((field) => field.value.length > 0),
            ...timestampFooter(),
            timestamp: new Date().toISOString(),
        },
    };
}

function toEmbedField(name: string, value: string, timestamp?: string): RelayEmbedField {
    const field: RelayEmbedField = {
        name,
        value: value.slice(0, 1024),
    };
    if (timestamp) {
        field.timestamp = timestamp;
    }
    return field;
}

function formatMaybeLink(value: unknown) {
    const stringValue = stringifyValue(value);
    if (!stringValue) {
        return "";
    }
    if (!URL.canParse(stringValue)) {
        return stringValue;
    }
    return `[${stringValue}](${stringValue})`;
}

function formatModActionValue(key: string, value: unknown) {
    const record = asRecord(value);
    if (Object.keys(record).length === 0) {
        return isDateKey(key) ? formatDateValue(value) : formatMaybeLink(value);
    }
    if (!hasMeaningfulValue(record)) {
        return "";
    }

    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("subreddit")) {
        return formatSubreddit(record);
    }
    if (normalizedKey.includes("moderator") || normalizedKey.includes("user") || normalizedKey.includes("author")) {
        return formatUser(record);
    }
    if (normalizedKey.includes("comment")) {
        return formatComment(record);
    }
    if (normalizedKey.includes("post")) {
        return formatPost(record);
    }

    return formatRecordSummary(record);
}

function formatSubreddit(record: UnknownRecord) {
    const name = getString(record, "name");
    if (!name) {
        return formatRecordSummary(record);
    }
    return formatMarkdownLink(`r/${name}`, redditUrl(getString(record, "permalink") || `/r/${name}`));
}

function formatUser(record: UnknownRecord) {
    const name = getString(record, "name") || getString(record, "username") || getString(record, "author");
    if (!name) {
        return formatRecordSummary(record);
    }
    if (isRedditAdminModeratorName(name)) {
        return "Reddit Admin";
    }
    return formatMarkdownLink(`u/${name}`, getString(record, "url") || `https://www.reddit.com/user/${name}`);
}

function formatModmailAuthor(name: string) {
    const username = name.trim().replace(/^u\//i, "");
    if (!username) {
        return "";
    }
    return formatMarkdownLink(`u/${username}`, `https://www.reddit.com/user/${encodeURIComponent(username)}`);
}

function formatModmailAuthorType(value: string) {
    const normalized = value
        .trim()
        .replace(/^participating[_\s-]?as[_\s-]?/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
    if (!normalized) {
        return "";
    }
    return normalized
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

function formatModmailBody(value: string) {
    const decoded = decodeHtmlEntities(value);
    if (!/<[a-z][\s\S]*>/i.test(decoded)) {
        return decoded;
    }
    return decodeHtmlEntities(decoded
        .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, url: string, label: string) => formatMarkdownLink(stripHtml(label), url))
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|blockquote)>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "- ")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim());
}

function formatModmailLink(conversationId: string, messageId: string) {
    const url = getModmailUrl(conversationId, messageId);
    return url ? formatMarkdownLink("Open Modmail Message", url) : "";
}

function stripHtml(value: string) {
    return decodeHtmlEntities(value.replace(/<[^>]+>/g, "").trim());
}

function decodeHtmlEntities(value: string) {
    return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, raw: string) => {
        const numericValue = raw.startsWith("#x")
            ? Number.parseInt(raw.slice(2), 16)
            : raw.startsWith("#")
                ? Number.parseInt(raw.slice(1), 10)
                : undefined;
        if (numericValue !== undefined) {
            return Number.isFinite(numericValue) ? String.fromCodePoint(numericValue) : entity;
        }
        switch (raw.toLowerCase()) {
            case "amp":
                return "&";
            case "lt":
                return "<";
            case "gt":
                return ">";
            case "quot":
                return "\"";
            case "apos":
            case "rsquo":
                return "'";
            case "nbsp":
                return " ";
            default:
                return entity;
        }
    });
}

function getModlogUrl(record: UnknownRecord) {
    const subredditName = getModlogSubredditName(record);
    const moderatorName = getModlogModeratorName(record);
    if (!subredditName || !moderatorName) {
        return "";
    }
    const moderatorFilter = isRedditAdminModeratorName(moderatorName) ? "a" : moderatorName;
    return `https://www.reddit.com/mod/${encodeURIComponent(subredditName)}/log?moderatorNames=${encodeURIComponent(moderatorFilter)}`;
}

function getModlogSubredditName(record: UnknownRecord) {
    const subreddit = asRecord(record.subreddit);
    const name = getString(subreddit, "name")
        || getString(subreddit, "displayName")
        || getString(subreddit, "display_name")
        || getString(record, "subredditName")
        || getString(record, "subreddit");
    return name.replace(/^\/?r\//i, "");
}

function getModlogModeratorName(record: UnknownRecord) {
    const moderator = asRecord(record.moderator);
    return getString(moderator, "name")
        || getString(moderator, "username")
        || getString(record, "moderatorName")
        || getString(record, "moderator");
}

function isRedditAdminModeratorName(name: string) {
    return REDDIT_ADMIN_MODERATOR_NAMES.has(name.trim());
}

function formatComment(record: UnknownRecord) {
    const permalink = getString(record, "permalink");
    const author = getString(record, "author");
    const id = getString(record, "id");
    const label = author ? `Comment by u/${author}` : id ? `Comment ${id}` : "Comment";
    if (permalink) {
        return formatMarkdownLink(label, redditUrl(permalink));
    }
    return getString(record, "body");
}

function formatPost(record: UnknownRecord) {
    const permalink = getString(record, "permalink");
    const title = getString(record, "title") || getString(record, "id") || "Post";
    if (permalink) {
        return formatMarkdownLink(title, redditUrl(permalink));
    }
    const url = getString(record, "url");
    return url ? formatMarkdownLink(title, url) : title;
}

function formatRecordSummary(record: UnknownRecord) {
    return Object.entries(record)
        .filter(([, value]) => isMeaningfulScalar(value))
        .slice(0, 4)
        .map(([key, value]) => `${labelize(key)}: ${isDateKey(key) ? formatDateValue(value) : formatMaybeLink(value)}`)
        .join("\n");
}

function hasMeaningfulValue(record: UnknownRecord): boolean {
    return Object.values(record).some((value) => {
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        if (value !== null && typeof value === "object") {
            return hasMeaningfulValue(asRecord(value));
        }
        return isMeaningfulScalar(value);
    });
}

function isMeaningfulScalar(value: unknown) {
    return value !== undefined
        && value !== null
        && value !== ""
        && value !== false
        && value !== 0;
}

function formatMarkdownLink(label: string, url: string) {
    return `[${label}](${url})`;
}

function formatDateValue(value: unknown) {
    const date = parseDate(value);
    return date ? DATE_FORMATTER.format(date) : stringifyValue(value);
}

function dateTimestamp(key: string, value: unknown) {
    if (!isDateKey(key)) {
        return undefined;
    }
    return parseDate(value)?.toISOString();
}

function parseDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value;
    }
    if (typeof value === "number") {
        if (value === 0) {
            return undefined;
        }
        const milliseconds = Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
    }
    const trimmed = value.trim();
    const numericValue = Number(trimmed);
    const date = Number.isFinite(numericValue) && /^\d+(\.\d+)?$/.test(trimmed)
        ? parseDate(numericValue)
        : new Date(trimmed);
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

function isDateKey(key: string) {
    const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
    return normalized.includes("created")
        || normalized.includes("updated")
        || normalized.includes("modified")
        || normalized.includes("timestamp")
        || normalized.includes("actionedat");
}

function redditUrl(permalink: string) {
    return new URL(permalink, "https://www.reddit.com").toString();
}

function labelize(key: string) {
    return key
        .replace(/([A-Z])/g, " $1")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}

function formatUserReports(item: RedditItem) {
    return getReportReasons(item, "user")
        .map((reason) => `${getReportCount(item)} - ${reason}`)
        .join("\n");
}

function formatModReports(item: RedditItem) {
    return getReportReasons(item, "mod")
        .map((reason) => `Moderator - ${reason}`)
        .join("\n");
}

export function getReportReasons(item: RedditItem, type: "mod" | "user") {
    const record = asRecord(item);
    const reportKey = type === "mod" ? "modReportReasons" : "userReportReasons";
    const rawReports = record[reportKey];
    return Array.isArray(rawReports)
        ? rawReports.map((report) => stringifyValue(report)).filter(Boolean)
        : [];
}

export function getReportCount(item: RedditItem) {
    const record = asRecord(item);
    if (isCommentItem(item)) {
        return typeof record.numReports === "number" ? record.numReports : getReportReasons(item, "user").length + getReportReasons(item, "mod").length;
    }
    return typeof record.numberOfReports === "number" ? record.numberOfReports : getReportReasons(item, "user").length + getReportReasons(item, "mod").length;
}

function getModmailUrl(conversationId: string, messageId: string) {
    if (!conversationId) {
        return "";
    }
    const normalizedConversationId = stripRedditThingPrefix(conversationId);
    const normalizedMessageId = stripRedditThingPrefix(messageId);
    return `https://mod.reddit.com/mail/all/${normalizedConversationId}${normalizedMessageId ? `/${normalizedMessageId}` : ""}`;
}

function stripRedditThingPrefix(id: string) {
    return id.replace(REDDIT_THING_ID_PREFIX_PATTERN, "");
}

function timestampFooter() {
    const date = new Date();
    return {
        footer: `Forwarded at ${formatDateValue(date)}`,
        footerTimestamp: date.toISOString(),
    };
}

function getBooleanish(value: unknown) {
    return value === true || value === "true";
}
