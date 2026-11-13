import {describe, expect, it} from "vitest";

import {
    buildModActionMessage,
    buildModmailMessage,
    buildModqueueMessage,
    buildReportedMessage,
} from "../../src/server/services/messages.js";

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
    it("includes subreddit, author and a titled content link on modqueue posts", () => {
        const message = buildModqueueMessage({
            id: "post123",
            subredditName: "nasa",
            authorName: "DotFlimsy5712",
            title: "Is this super rare pre a glitch",
            permalink: "/r/nasa/comments/1x1n7ff/is_this_super_rare_pre_a_glitch/",
            userReportReasons: [],
            modReportReasons: [],
            numberOfReports: 0,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Subreddit", value: "[r/nasa](https://www.reddit.com/r/nasa)"},
            {name: "Author", value: "[u/DotFlimsy5712](https://www.reddit.com/user/DotFlimsy5712)"},
            {
                name: "Link to content",
                value: "[Post: Is this super rare pre a glitch](https://www.reddit.com/r/nasa/comments/1x1n7ff/is_this_super_rare_pre_a_glitch/)",
            },
        ]));
    });

    it("labels modqueue comment links with the start of the comment body", () => {
        const message = buildModqueueMessage({
            id: "comment123",
            parentId: "post123",
            subredditName: "nasa",
            authorName: "alice",
            body: "First line\nsecond line",
            permalink: "/r/nasa/comments/post123/example/comment123",
            userReportReasons: [],
            modReportReasons: [],
            numReports: 0,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {
                name: "Link to content",
                value: "[Comment: First line second line](https://www.reddit.com/r/nasa/comments/post123/example/comment123)",
            },
        ]));
    });

    it("truncates long link labels and strips brackets that would break the markdown", () => {
        const message = buildModqueueMessage({
            id: "post123",
            subredditName: "nasa",
            authorName: "alice",
            title: `[Serious] ${"a".repeat(200)}`,
            permalink: "/r/nasa/comments/post123/example/",
            userReportReasons: [],
            modReportReasons: [],
            numberOfReports: 0,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        const link = message.embed?.fields?.find((field) => field.name === "Link to content")?.value ?? "";
        expect(link).not.toContain("[Serious]");
        expect(link.startsWith("[Post: Serious ")).toBe(true);
        expect(link).toContain("\u2026](https://www.reddit.com/r/nasa/comments/post123/example/)");
    });

    it("leaves deleted modqueue authors unlinked", () => {
        const message = buildModqueueMessage({
            id: "post123",
            subredditName: "nasa",
            authorName: "[deleted]",
            title: "A post",
            permalink: "/r/nasa/comments/post123/example/",
            userReportReasons: [],
            modReportReasons: [],
            numberOfReports: 0,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Author", value: "[deleted]"},
        ]));
    });

    it("omits subreddit and author fields when the item does not carry them", () => {
        const message = buildModqueueMessage({
            id: "post123",
            permalink: "/r/test/comments/post123/example",
            userReportReasons: ["spam"],
            modReportReasons: [],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        const names = (message.embed?.fields ?? []).map((field) => field.name);
        expect(names).not.toContain("Subreddit");
        expect(names).not.toContain("Author");
        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Link to content", value: "[View post](https://www.reddit.com/r/test/comments/post123/example)"},
        ]));
    });
    it("labels the reported content link with the post title instead of the raw URL", () => {
        const message = buildReportedMessage({
            id: "post123",
            subredditName: "Lil_SpazJoekp",
            authorName: "alice",
            title: "Test post pls ignore",
            permalink: "/r/Lil_SpazJoekp/comments/1q9fdaq/test_post_pls_ignore/",
            userReportReasons: ["Spam"],
            modReportReasons: [],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildReportedMessage>[0], {reporter: "bob"});

        expect(message.embed?.fields).toEqual(expect.arrayContaining([{
            name: "Link to content",
            value: "[Post: Test post pls ignore](https://www.reddit.com/r/Lil_SpazJoekp/comments/1q9fdaq/test_post_pls_ignore/)",
        }]));
    });

    it("emits bare URLs in mod action fields rather than self-referential links", () => {
        const message = buildModActionMessage({
            type: "ModAction",
            action: "removelink",
            targetPermalink: "https://www.reddit.com/r/test/comments/abc/",
        });

        // Discord renders `[url](url)` as literal markdown; a bare URL auto-links.
        expect(message.embed?.fields).toEqual(expect.arrayContaining([{
            name: "Target Permalink",
            value: "https://www.reddit.com/r/test/comments/abc/",
        }]));
    });
    it("names the reporting moderator on a mod report", () => {
        const message = buildReportedMessage({
            id: "post123",
            subredditName: "test",
            authorName: "alice",
            title: "A post",
            permalink: "/r/test/comments/post123/a_post/",
            userReportReasons: [],
            modReports: [{reason: "Spam", author: "Lil_SpazJoekp"}],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildReportedMessage>[0], {});

        expect(message.embed?.title).toBe("New Mod Report");
        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Reporter", value: "[u/Lil_SpazJoekp](https://www.reddit.com/user/Lil_SpazJoekp)"},
            {name: "Report body", value: "Spam"},
        ]));
    });

    it("lists each distinct reporting moderator once", () => {
        const message = buildReportedMessage({
            id: "post123",
            permalink: "/r/test/comments/post123/a_post/",
            title: "A post",
            userReportReasons: [],
            modReports: [
                {reason: "Spam", author: "modone"},
                {reason: "Rule 1", author: "modtwo"},
                {reason: "Also spam", author: "modone"},
            ],
            numberOfReports: 3,
        } as unknown as Parameters<typeof buildReportedMessage>[0], {});

        const reporter = message.embed?.fields?.find((field) => field.name === "Reporter")?.value;
        expect(reporter).toBe("[u/modone](https://www.reddit.com/user/modone), [u/modtwo](https://www.reddit.com/user/modtwo)");
    });

    it("leaves the reporter empty for anonymous user reports", () => {
        const message = buildReportedMessage({
            id: "post123",
            permalink: "/r/test/comments/post123/a_post/",
            title: "A post",
            userReportReasons: ["Spam"],
            modReports: [],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildReportedMessage>[0], {});

        expect(message.embed?.fields?.map((field) => field.name)).not.toContain("Reporter");
    });

    it("attributes modqueue mod reports to the moderator who filed them", () => {
        const message = buildModqueueMessage({
            id: "post123",
            permalink: "/r/test/comments/post123/a_post/",
            title: "A post",
            userReportReasons: [],
            modReports: [{reason: "Rule 1", author: "modone"}],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Mod Reports", value: "[u/modone](https://www.reddit.com/user/modone) - Rule 1"},
        ]));
    });

    it("falls back to the deprecated modReportReasons when modReports is absent", () => {
        const message = buildModqueueMessage({
            id: "post123",
            permalink: "/r/test/comments/post123/a_post/",
            title: "A post",
            userReportReasons: [],
            modReportReasons: ["Rule 1"],
            numberOfReports: 1,
        } as unknown as Parameters<typeof buildModqueueMessage>[0]);

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Mod Reports", value: "Moderator - Rule 1"},
        ]));
    });

    it.each([
        ["appeals", "Appeals"],
        ["inprogress", "In Progress"],
        ["new", "New"],
        ["archived", "Archived"],
        ["joinrequests", "Join Requests"],
        ["InProgress", "In Progress"],
        ["some_new_state", "Some New State"],
    ])("shows the modmail conversation state %s as %s", (conversationState, expected) => {
        const message = buildModmailMessage({
            messageAuthor: {name: "Lil_SpazTest"},
            messageAuthorType: "ParticipatingAs_PARTICIPANT_USER",
            conversationState,
            conversationId: "ModmailConversation_3v8whd",
            messageId: "ModmailMessage_5jtdmq",
        });

        expect(message.embed?.fields).toEqual(expect.arrayContaining([
            {name: "Conversation State", value: expected},
        ]));
    });

    it("omits the conversation state when the payload has none", () => {
        const message = buildModmailMessage({messageAuthor: {name: "auser"}, messageId: "m1"});

        expect(message.embed?.fields?.map((field) => field.name)).not.toContain("Conversation State");
    });
});
