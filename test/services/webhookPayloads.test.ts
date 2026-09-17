import {describe, expect, it} from "vitest";

import {buildWebhookPayload, detectWebhookProvider} from "../../src/server/services/webhookPayloads.js";

describe("webhook payloads", () => {
    it("detects Slack webhook URLs", () => {
        expect(detectWebhookProvider("https://hooks.slack.com/services/T/B/C")).toBe("slack");
    });

    it("defaults non-Slack webhook URLs to Discord", () => {
        expect(detectWebhookProvider("https://discord.com/api/webhooks/123/token")).toBe("discord");
        expect(detectWebhookProvider("not-a-url")).toBe("discord");
    });

    it("builds Discord content payloads", () => {
        expect(buildWebhookPayload("https://discord.com/api/webhooks/123/token", {content: "hello"})).toEqual({
            content: "hello",
            allowed_mentions: {
                parse: ["roles", "users", "everyone"],
            },
        });
    });

    it("normalizes Discord markdown links with angle-bracketed targets", () => {
        expect(buildWebhookPayload("https://discord.com/api/webhooks/123/token", {
            content: "New [post](<https://www.reddit.com/r/test/comments/abc>) by [u/test](<https://www.reddit.com/user/test>)!",
            embed: {
                title: "New Report",
                description: "Review [the report](<https://www.reddit.com/r/test/comments/abc>)",
                fields: [{
                    name: "Subreddit",
                    value: "[r/test](<https://www.reddit.com/r/test>)",
                }],
            },
        })).toEqual({
            content: "New [post](https://www.reddit.com/r/test/comments/abc) by [u/test](https://www.reddit.com/user/test)!",
            allowed_mentions: {
                parse: ["roles", "users", "everyone"],
            },
            embeds: [{
                title: "New Report",
                description: "Review [the report](https://www.reddit.com/r/test/comments/abc)",
                fields: [{
                    name: "Subreddit",
                    value: "[r/test](https://www.reddit.com/r/test)",
                }],
            }],
        });
    });

    it("builds Discord embed payloads with native timestamp markup", () => {
        expect(buildWebhookPayload("https://discord.com/api/webhooks/123/token", {
            embed: {
                title: "Mod Action",
                fields: [
                    {
                        name: "Actioned At",
                        value: "Jul 10, 2026, 5:04 PM UTC",
                        timestamp: "2026-07-10T17:04:11.093Z",
                    },
                    {name: "Action", value: "dev_platform_app_changed"},
                ],
                footer: "Forwarded at Jul 10, 2026, 5:09 PM UTC",
                footerTimestamp: "2026-07-10T17:09:45.008Z",
                timestamp: "2026-07-10T17:04:11.093Z",
            },
        })).toEqual({
            content: "",
            allowed_mentions: {
                parse: ["roles", "users", "everyone"],
            },
            embeds: [{
                title: "Mod Action",
                fields: [
                    {
                        name: "Actioned At",
                        value: "<t:1783703051:F>",
                    },
                    {
                        name: "Action",
                        value: "dev_platform_app_changed",
                    },
                ],
                footer: {text: "Forwarded at"},
                timestamp: "2026-07-10T17:09:45.008Z",
            }],
        });
    });

    it("converts Discord markdown links for Slack content payloads", () => {
        expect(buildWebhookPayload("https://hooks.slack.com/services/T/B/C", {
            content: "New [post](https://www.reddit.com/r/test/comments/abc) by [u/test](<https://www.reddit.com/user/test>)!",
        })).toEqual({
            text: "New <https://www.reddit.com/r/test/comments/abc|post> by <https://www.reddit.com/user/test|u/test>!",
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "New <https://www.reddit.com/r/test/comments/abc|post> by <https://www.reddit.com/user/test|u/test>!",
                },
            }],
        });
    });

    it("builds Slack embed payloads", () => {
        expect(buildWebhookPayload("https://hooks.slack.com/services/T/B/C", {
            embed: {
                title: "Mod Action",
                fields: [
                    {name: "Action", value: "banuser"},
                    {
                        name: "Actioned At",
                        value: "Jan 1, 2026, 12:00 AM UTC",
                        timestamp: "2026-01-01T00:00:00.000Z",
                    },
                    {name: "Subreddit", value: "[r/test](https://www.reddit.com/r/test)"},
                ],
                timestamp: "2026-01-01T00:00:00.000Z",
            },
        })).toEqual({
            text: "Mod Action",
            blocks: [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: "Mod Action",
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "*Action*\nbanuser",
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "*Actioned At*\n<!date^1767225600^{date_short_pretty} at {time}|Jan 1, 2026, 12:00 AM UTC>",
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "*Subreddit*\n<https://www.reddit.com/r/test|r/test>",
                    },
                },
                {
                    type: "context",
                    elements: [{
                        type: "mrkdwn",
                        text: "<!date^1767225600^{date_short_pretty} at {time_secs}|2026-01-01T00:00:00.000Z>",
                    }],
                },
            ],
        });
    });
});
