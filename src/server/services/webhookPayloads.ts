import type {JsonObject} from "@devvit/web/shared";

import type {RelayEmbed, RelayEmbedField, RelayMessage} from "../types.js";

type WebhookProvider = "discord" | "slack";

const SLACK_EMBED_COLOR = "#FF4500";

export function detectWebhookProvider(webhookUrl: string): WebhookProvider {
    try {
        const host = new URL(webhookUrl).hostname.toLowerCase();
        return host.includes("slack.com") ? "slack" : "discord";
    } catch {
        return "discord";
    }
}

export function buildWebhookPayload(webhookUrl: string, message: RelayMessage): JsonObject {
    return detectWebhookProvider(webhookUrl) === "slack"
        ? buildSlackPayload(message)
        : buildDiscordPayload(message);
}

function buildDiscordPayload(message: RelayMessage): JsonObject {
    const content = [
        toDiscordMrkdwn(message.content || ""),
        message.mentions?.discord?.join(" ") ?? "",
    ].filter(Boolean).join("\n");
    const payload: Record<string, unknown> = {
        content,
        allowed_mentions: {
            parse: [
                "roles",
                "users",
                "everyone",
            ],
        },
    };

    if (message.embed) {
        const embed: Record<string, unknown> = {
            title: message.embed.title,
            description: message.embed.description ? toDiscordMrkdwn(message.embed.description) : undefined,
            url: message.embed.url,
            fields: message.embed.fields?.map(toDiscordField),
            footer: buildDiscordFooter(message.embed),
            timestamp: message.embed.footerTimestamp || message.embed.timestamp,
        };
        payload.embeds = [stripUndefined(embed)];
    }

    return stripUndefined(payload) as JsonObject;
}

// Mentions only notify from the top-level message, never from inside an attachment, so
// they sit above the card and lead the notification text.
function buildSlackPayload(message: RelayMessage): JsonObject {
    const mentions = message.mentions?.slack?.join(" ") ?? "";
    const card = buildSlackCard(message);
    const content = message.slack || !message.content ? "" : toSlackMrkdwn(message.content);
    const lead = [content, mentions].filter(Boolean).join("\n");

    return stripUndefined({
        text: [mentions, content || card?.text].filter(Boolean).join(" "),
        blocks: lead ? [sectionBlock(lead)] : undefined,
        attachments: card
            ? [{
                color: SLACK_EMBED_COLOR,
                blocks: card.blocks.slice(0, 50),
            }]
            : undefined,
    }) as JsonObject;
}

// An attachment is Slack's equivalent of a Discord embed: its blocks render inside a card
// with a colored side bar.
function buildSlackCard(message: RelayMessage): {text: string; blocks: Record<string, unknown>[]} | undefined {
    if (message.slack) {
        return message.slack;
    }
    if (!message.embed) {
        return undefined;
    }

    const blocks: Record<string, unknown>[] = [];
    if (message.embed.title) {
        blocks.push(headerBlock(message.embed.title));
    }
    if (message.embed.description) {
        blocks.push(sectionBlock(toSlackMrkdwn(message.embed.description)));
    }
    for (const field of message.embed.fields ?? []) {
        blocks.push(sectionBlock(`*${escapeSlackText(field.name)}*\n${toSlackFieldValue(field)}`));
    }
    const context = buildSlackContext(message);
    if (context) {
        blocks.push(contextBlock(context));
    }
    return {text: escapeSlackText(message.embed.title), blocks};
}

function toDiscordField(field: RelayEmbedField) {
    return stripUndefined({
        name: field.name,
        value: field.timestamp ? discordTimestamp(field.timestamp) : toDiscordMrkdwn(field.value),
        inline: field.inline,
    });
}

function buildDiscordFooter(embed: RelayEmbed) {
    const text = embed.footerTimestamp && embed.footer?.startsWith("Forwarded at")
        ? "Forwarded at"
        : embed.footer;
    return text ? {text} : undefined;
}

export function sectionBlock(text: string) {
    return {
        type: "section",
        text: {
            type: "mrkdwn",
            text: truncate(text, 3000),
        },
    };
}

export function headerBlock(text: string) {
    return {
        type: "header",
        text: {
            type: "plain_text",
            text: truncate(text.replace(/\s+/g, " "), 150),
        },
    };
}

export function contextBlock(text: string) {
    return {
        type: "context",
        elements: [{
            type: "mrkdwn",
            text: truncate(text, 3000),
        }],
    };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
    for (const key of Object.keys(value)) {
        if (value[key] === undefined) {
            delete value[key];
        }
    }
    return value;
}

function buildSlackContext(message: RelayMessage) {
    if (message.embed?.footerTimestamp) {
        return `Forwarded at ${slackTimestamp(message.embed.footerTimestamp, message.embed.footer)}`;
    }
    if (message.embed?.footer) {
        return escapeSlackText(message.embed.footer);
    }
    if (!message.embed?.timestamp) {
        return "";
    }
    const timestamp = Math.floor(new Date(message.embed.timestamp).getTime() / 1000);
    if (!Number.isFinite(timestamp)) {
        return "";
    }
    return `<!date^${timestamp}^{date_short_pretty} at {time_secs}|${escapeSlackText(message.embed.timestamp)}>`;
}

function toSlackFieldValue(field: RelayEmbedField) {
    return field.timestamp
        ? slackTimestamp(field.timestamp, field.value)
        : toSlackMrkdwn(field.value);
}

function discordTimestamp(value: string) {
    const timestamp = epochSeconds(value);
    return timestamp === undefined ? value : `<t:${timestamp}:F>`;
}

export function slackTimestamp(value: string, fallback = value) {
    const timestamp = epochSeconds(value);
    return timestamp === undefined
        ? escapeSlackText(fallback)
        : `<!date^${timestamp}^{date_short_pretty} at {time}|${escapeSlackText(fallback)}>`;
}

function epochSeconds(value: string) {
    const timestamp = Math.floor(new Date(value).getTime() / 1000);
    return Number.isFinite(timestamp) ? timestamp : undefined;
}

function toDiscordMrkdwn(value = "") {
    return value.replace(/\[([^\]]+)]\(<(https?:\/\/[^>]+)>\)/g, "[$1]($2)");
}

export function toSlackMrkdwn(value = "") {
    const normalized = value.replace(/\*\*([^*]+)\*\*/g, "*$1*");
    const linkPattern = /\[([^\]]+)]\(<?(https?:\/\/[^)>]+)>?\)/g;
    let result = "";
    let lastIndex = 0;
    for (const match of normalized.matchAll(linkPattern)) {
        result += escapeSlackText(normalized.slice(lastIndex, match.index));
        result += `<${escapeSlackUrl(match[2])}|${escapeSlackText(match[1])}>`;
        lastIndex = match.index + match[0].length;
    }
    result += escapeSlackText(normalized.slice(lastIndex));
    return result;
}

export function escapeSlackText(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function escapeSlackUrl(value: string) {
    return value
        .replace(/>/g, "%3E")
        .replace(/\|/g, "%7C");
}

export function truncate(value: string, maxLength: number) {
    return value.length > maxLength ? value.slice(0, maxLength - 3) + "..." : value;
}
