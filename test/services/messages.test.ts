import {describe, expect, it} from "vitest";

import {buildModActionMessage, buildModmailMessage, buildModqueueMessage} from "../../src/server/services/messages.js";

describe("relay messages", () => {
    it("formats mod action reddit objects as links instead of JSON", () => {
        const message = buildModActionMessage({
            type: "ModAction",
            action: "invitemoderator",
            actionedAt: "2026-07-10T17:04:11.093Z",
            subreddit: {
                id: "t5_f9v5nf",
                name: "discord_relay_dev",
                permalink: "/r/discord_relay_dev",
            },
            moderator: {
                id: "t2_o77bz",
                name: "Lil_SpazJoekp",
                url: "https://www.reddit.com/user/Lil_SpazJoekp",
            },
            targetUser: {
                id: "t2_2dqxc4tzxd",
                name: "lil_spazmin",
                url: "https://www.reddit.com/user/lil_spazmin",
            },
            targetComment: {
                id: "",
                body: "",
                author: "",
                permalink: "",
            },
            targetPost: {
                id: "",
                title: "",
                permalink: "",
            },
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "Action", value: "invitemoderator"}),
            expect.objectContaining({
                name: "Actioned At",
                value: "Jul 10, 2026, 5:04 PM UTC",
                timestamp: "2026-07-10T17:04:11.093Z",
            }),
            expect.objectContaining({
                name: "Subreddit",
                value: "[r/discord_relay_dev](https://www.reddit.com/r/discord_relay_dev)",
            }),
            expect.objectContaining({
                name: "Moderator",
                value: "[u/Lil_SpazJoekp](https://www.reddit.com/user/Lil_SpazJoekp)",
            }),
            expect.objectContaining({
                name: "Modlog",
                value: "[View Modlog](https://www.reddit.com/mod/discord_relay_dev/log?moderatorNames=Lil_SpazJoekp)",
            }),
            expect.objectContaining({
                name: "Target User",
                value: "[u/lil_spazmin](https://www.reddit.com/user/lil_spazmin)",
            }),
        ]));
        expect(message.embed?.fields?.some((field) => field.name === "Target Comment")).toBe(false);
        expect(message.embed?.fields?.some((field) => field.name === "Target Post")).toBe(false);
        expect(message.embed?.footer).toMatch(/^Forwarded at [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M UTC$/);
        expect(message.embed?.footerTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(message.embed?.footer).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
        expect(JSON.stringify(message)).not.toContain("{\"id\":\"t5_f9v5nf\"");
    });

    it.each([
        "Anti-Evil Operations",
        "Reddit Legal",
        "[ redacted ]",
    ])("formats %s modlog moderators as Reddit Admin", (moderatorName) => {
        const message = buildModActionMessage({
            type: "ModAction",
            action: "removecomment",
            subreddit: {
                name: "discord_relay_dev",
            },
            moderator: {
                name: moderatorName,
                url: `https://www.reddit.com/user/${encodeURIComponent(moderatorName)}`,
            },
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "Moderator",
                value: "Reddit Admin",
            }),
            expect.objectContaining({
                name: "Modlog",
                value: "[View Modlog](https://www.reddit.com/mod/discord_relay_dev/log?moderatorNames=a)",
            }),
        ]));
        expect(JSON.stringify(message)).not.toContain(`[u/${moderatorName}]`);
    });

    it("removes reddit thing prefixes from modmail message links", () => {
        const message = buildModmailMessage({
            type: "ModMail",
            conversationId: "t4_conversation123",
            messageId: "t4_message456",
            messageAuthorType: "participant_user",
            messageAuthor: {
                name: "example_user",
            },
            createdAt: "2026-07-10T17:04:11.093Z",
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "Link to Modmail Message",
                value: "[Open Modmail Message](https://mod.reddit.com/mail/all/conversation123/message456)",
            }),
        ]));
    });

    it("removes Devvit modmail prefixes from modmail message links", () => {
        const message = buildModmailMessage({
            type: "ModMail",
            conversationId: "ModmailConversation_conversation123",
            messageId: "ModmailMessage_message456",
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "Link to Modmail Message",
                value: "[Open Modmail Message](https://mod.reddit.com/mail/all/conversation123/message456)",
            }),
        ]));
    });

    it("formats modmail author, author type, html body, and link label", () => {
        const message = buildModmailMessage({
            type: "ModMail",
            conversationId: "conversation123",
            messageId: "message456",
            message: {
                id: "message456",
                body: "<p>Hello <strong>mods</strong> &amp; team<br><a href=\"https://www.reddit.com/r/test\">open subreddit</a></p>",
                participatingAs: "ParticipatingAs_MODERATOR",
                author: {
                    name: "example_user",
                },
            },
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "Author Type",
                value: "Moderator",
            }),
            expect.objectContaining({
                name: "Author",
                value: "[u/example_user](https://www.reddit.com/user/example_user)",
            }),
            expect.objectContaining({
                name: "Message",
                value: "Hello mods & team\n[open subreddit](https://www.reddit.com/r/test)",
            }),
            expect.objectContaining({
                name: "Link to Modmail Message",
                value: "[Open Modmail Message](https://mod.reddit.com/mail/all/conversation123/message456)",
            }),
        ]));
    });

    it("includes title, subject, and message fields for modmail forwards", () => {
        const message = buildModmailMessage({
            type: "ModMail",
            conversation: {
                id: "ModmailConversation_conversation123",
                title: "Conversation title",
                subject: "Subject line",
                createdAt: "2026-07-10T17:04:11.093Z",
            },
            message: {
                id: "ModmailMessage_message456",
                body: "Modmail body text",
                author: {
                    name: "example_user",
                    type: "participant_user",
                },
            },
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "Title", value: "Conversation title"}),
            expect.objectContaining({name: "Subject", value: "Subject line"}),
            expect.objectContaining({name: "Message", value: "Modmail body text"}),
        ]));
    });

    it("labels modqueue posts and comments separately", () => {
        const postMessage = buildModqueueMessage({
            id: "post123",
            permalink: "/r/test/comments/post123/example",
            userReportReasons: ["spam"],
            modReportReasons: [],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);
        const commentMessage = buildModqueueMessage({
            id: "comment123",
            parentId: "post123",
            permalink: "/r/test/comments/post123/example/comment123",
            userReportReasons: [],
            modReportReasons: ["rule 1"],
            numReports: 1,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        expect(postMessage.embed).toEqual(expect.objectContaining({
            title: "New Modqueue Post",
            fields: expect.arrayContaining([
                expect.objectContaining({name: "Item Type", value: "Post"}),
            ]),
        }));
        expect(commentMessage.embed).toEqual(expect.objectContaining({
            title: "New Modqueue Comment",
            fields: expect.arrayContaining([
                expect.objectContaining({name: "Item Type", value: "Comment"}),
            ]),
        }));
    });
});
