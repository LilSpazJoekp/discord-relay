import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {
        modMail: {
            getConversation: vi.fn(),
        },
        getCurrentSubreddit: vi.fn(),
    },
    settings: {
        get: vi.fn(),
    },
}));

vi.mock("../../src/server/services/destinations.js", () => ({
    getDestinations: vi.fn(),
    isBucketEnabled: vi.fn(),
}));

vi.mock("../../src/server/services/relay.js", () => ({
    relayToDestinations: vi.fn(),
}));

import {reddit, settings} from "@devvit/web/server";

import {getDestinations, isBucketEnabled} from "../../src/server/services/destinations.js";
import {relayToDestinations} from "../../src/server/services/relay.js";
import {handleModmailTrigger} from "../../src/server/handlers/modmail.js";

const getConversation = vi.mocked(reddit.modMail.getConversation);
const getConfiguredDestinations = vi.mocked(getDestinations);
const getBucketEnabled = vi.mocked(isBucketEnabled);
const relay = vi.mocked(relayToDestinations);
const getCurrentSubreddit = vi.mocked(reddit.getCurrentSubreddit);
let scenario: string;
let ignoreUsernames: string;
let globalIgnoreUsernames: string;

function mockModerators(...usernames: string[]) {
    const moderators = usernames.map((username) => username.toLowerCase());
    getCurrentSubreddit.mockResolvedValue({
        // getModerators({username}) filters server-side, so only matches come back.
        getModerators: vi.fn(({username}: {username?: string} = {}) => ({
            all: async () => moderators
                .filter((moderator) => !username || moderator === username.toLowerCase())
                .map((moderator) => ({username: moderator})),
        })),
    } as never);
}

describe("modmail handler", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-17T13:00:00Z"));
        getConversation.mockReset();
        getConfiguredDestinations.mockReset();
        getBucketEnabled.mockReset();
        relay.mockReset();
        vi.mocked(settings.get).mockReset();
        scenario = "new-threads";
        ignoreUsernames = "";
        globalIgnoreUsernames = "";
        getCurrentSubreddit.mockReset();
        mockModerators();
        vi.mocked(settings.get).mockImplementation(async (name) => {
            if (name === "modmail-scenario") {
                return scenario;
            }
            if (name === "modmail-ignore-usernames") {
                return ignoreUsernames;
            }
            return name === "global-ignore-usernames" ? globalIgnoreUsernames : undefined;
        });

        getBucketEnabled.mockResolvedValue(true);
        getConfiguredDestinations.mockResolvedValue([{
            id: "destination-1",
            webhookUrl: "https://discord.com/api/webhooks/123/token",
            events: ["modmail"],
        }]);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("fetches modmail subject and message body before relaying", async () => {
        getConversation.mockResolvedValue({
            conversation: {
                id: "conversation123",
                subject: "Need moderator help",
                messages: {
                    message456: {
                        id: "message456",
                        body: "This is the modmail body.",
                        bodyMarkdown: "**This is the modmail body.**",
                        date: "2026-07-10T17:04:11.093Z",
                        author: {
                            name: "example_user",
                        },
                    },
                },
                modActions: {},
                authors: [],
                numMessages: 1,
            },
        });

        await handleModmailTrigger({
            type: "ModMail",
            conversationId: "ModmailConversation_conversation123",
            messageId: "ModmailMessage_message456",
            messageAuthorType: "participant_user",
            messageAuthor: {
                name: "example_user",
            },
            isNew: true,
        });

        expect(getConversation).toHaveBeenCalledWith({
            conversationId: "conversation123",
            markRead: false,
        });
        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.objectContaining({
                embed: expect.objectContaining({
                    fields: expect.arrayContaining([
                        expect.objectContaining({name: "Title", value: "Need moderator help"}),
                        expect.objectContaining({name: "Subject", value: "Need moderator help"}),
                        expect.objectContaining({name: "Message", value: "**This is the modmail body.**"}),
                    ]),
                    timestamp: "2026-07-10T17:04:11.093Z",
                }),
            }),
        }));
    });

    it("does not relay modmail action payloads", async () => {
        await handleModmailTrigger({
            type: "ModMail",
            conversationId: "conversation123",
            action: {
                id: "action456",
                actionType: "Archived",
            },
        });

        expect(getConversation).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it("does not fetch or relay messages when modmail is disabled", async () => {
        getBucketEnabled.mockResolvedValue(false);

        await handleModmailTrigger({isNew: true, conversationId: "conversation123"});

        expect(getConfiguredDestinations).not.toHaveBeenCalled();
        expect(getConversation).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it.each([
        {isNew: true},
        {isNewThread: true},
        {isNewConversation: true},
        {conversation: {numMessages: 1}},
    ])("recognizes new conversations from supported event fields: %j", async (event) => {
        await handleModmailTrigger({...event, messageId: "message456", body: "First message"});

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({uniqueId: "message456"}));
    });

    it("skips existing-thread replies in new-threads mode", async () => {
        await handleModmailTrigger({isNew: false, conversation: {numMessages: 2}, messageId: "message456"});

        expect(getConversation).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it.each([
        {message: {author: {type: "MoDeRaToR"}}},
        {author: {isMod: true}},
        {authorType: "moderator"},
        {messageAuthorType: "moderator"},
    ])("skips moderator replies in non-mod-replies mode: %j", async (event) => {
        scenario = "non-mod-replies";

        await handleModmailTrigger({...event, messageId: "message456"});

        expect(getConfiguredDestinations).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it("forwards participant replies in non-mod-replies mode", async () => {
        scenario = "non-mod-replies";

        await handleModmailTrigger({
            conversation: {numMessages: 2},
            message: {id: "message456", body: "A follow-up", author: {type: "participant_user", name: "alice"}},
        });

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            uniqueId: "message456", message: expect.objectContaining({embed: expect.objectContaining({title: "Modmail Reply"})}),
        }));
    });

    it("forwards moderator replies in all-messages mode", async () => {
        scenario = "all-messages";

        await handleModmailTrigger({messageId: "message456", messageAuthorType: "moderator"});

        expect(relay).toHaveBeenCalledOnce();
    });

    it("still excludes modmail actions in all-messages mode", async () => {
        scenario = "all-messages";

        await handleModmailTrigger({actionType: "Archived", conversationId: "conversation123"});

        expect(getConversation).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it("avoids enrichment when no destination matches", async () => {
        getConfiguredDestinations.mockResolvedValue([]);

        await handleModmailTrigger({isNew: true, conversationId: "conversation123"});

        expect(getConversation).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it.each([new Error("Modmail unavailable"), "Modmail unavailable"])("falls back to the trigger payload if enrichment fails: %s", async (failure) => {
        getConversation.mockRejectedValue(failure);

        await handleModmailTrigger({
            isNew: true, conversationId: "conversation123", messageId: "message456",
            subject: "Original subject", body: "Original body",
        });

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            uniqueId: "message456",
            message: expect.objectContaining({embed: expect.objectContaining({
                fields: expect.arrayContaining([
                    {name: "Subject", value: "Original subject"}, {name: "Message", value: "Original body"},
                ]),
            })}),
        }));
    });

    it("fills empty event fields from prefixed messages in the top-level response", async () => {
        getConversation.mockResolvedValue({
            conversation: {id: "conversation123", subject: "Fetched subject"},
            messages: {ModmailMessage_message456: {id: "message456", body: "Fetched body"}},
        } as never);

        await handleModmailTrigger({
            isNew: true,
            conversation: {id: "ModmailConversation_conversation123", subject: ""},
            message: {id: "message456", body: ""},
        });

        expect(getConversation).toHaveBeenCalledWith({conversationId: "conversation123", markRead: false});
        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            uniqueId: "message456",
            message: expect.objectContaining({embed: expect.objectContaining({
                fields: expect.arrayContaining([
                    {name: "Subject", value: "Fetched subject"}, {name: "Message", value: "Fetched body"},
                ]),
            })}),
        }));
    });

    it("preserves event content when the fetched conversation contains older values", async () => {
        getConversation.mockResolvedValue({
            conversation: {
                id: "conversation123", subject: "Old subject",
                messages: {message456: {id: "message456", body: "Old body"}},
            },
        } as never);

        await handleModmailTrigger({
            isNew: true, conversationId: "conversation123",
            conversation: {subject: "Current subject"},
            message: {id: "message456", body: "Current body"},
        });

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.objectContaining({embed: expect.objectContaining({
                fields: expect.arrayContaining([
                    {name: "Subject", value: "Current subject"}, {name: "Message", value: "Current body"},
                ]),
            })}),
        }));
    });

    it("does not select an unrelated fetched message when the event has no message ID", async () => {
        getConversation.mockResolvedValue({
            conversation: {id: "conversation123", subject: "Subject", messages: {other: {body: "Unrelated message"}}},
        } as never);

        await handleModmailTrigger({isNew: true, conversationId: "conversation123", id: "event123"});

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({uniqueId: "event123"}));
        expect(relay.mock.calls[0]![0].message.embed?.fields).not.toContainEqual(expect.objectContaining({name: "Message"}));
    });

    it("uses a timestamp identity when the trigger supplies no identifiers", async () => {
        await handleModmailTrigger({isNew: true, subject: "Subject", body: "Message"});

        expect(relay).toHaveBeenCalledWith(expect.objectContaining({uniqueId: String(Date.now())}));
        expect(getConversation).not.toHaveBeenCalled();
    });
    it("does not forward modmail from an author on the global ignore list", async () => {
        scenario = "all-messages";
        globalIgnoreUsernames = "auto-modmail";

        await handleModmailTrigger({messageId: "message456", messageAuthor: {name: "auto-modmail"}});

        expect(relay).not.toHaveBeenCalled();
    });

    it("does not forward modmail from an ignored username in any scenario", async () => {
        scenario = "all-messages";
        ignoreUsernames = "auto-modmail";

        await handleModmailTrigger({
            messageId: "message456",
            messageAuthorType: "participant_user",
            messageAuthor: {name: "auto-modmail"},
        });

        expect(relay).not.toHaveBeenCalled();
    });

    it.each([
        "AUTO-MODMAIL",
        "u/auto-modmail",
        " auto-modmail ",
        "someone,auto-modmail",
    ])("matches ignored usernames case-insensitively and tolerates u/ (%s)", async (configured) => {
        scenario = "all-messages";
        ignoreUsernames = configured;

        await handleModmailTrigger({messageId: "message456", messageAuthor: {name: "Auto-Modmail"}});

        expect(relay).not.toHaveBeenCalled();
    });

    it("still forwards modmail from an author that is not on the ignore list", async () => {
        scenario = "all-messages";
        ignoreUsernames = "auto-modmail";

        await handleModmailTrigger({messageId: "message456", messageAuthor: {name: "alice"}});

        expect(relay).toHaveBeenCalledTimes(1);
    });

    it("ignores every moderator when the list contains m", async () => {
        scenario = "all-messages";
        ignoreUsernames = "m";

        await handleModmailTrigger({
            messageId: "message456",
            messageAuthorType: "moderator",
            messageAuthor: {name: "amod"},
        });

        expect(relay).not.toHaveBeenCalled();
    });

    it("falls back to the moderator list for m when the payload carries no author type", async () => {
        scenario = "all-messages";
        ignoreUsernames = "m";
        mockModerators("auto-modmail");

        await handleModmailTrigger({messageId: "message456", messageAuthor: {name: "auto-modmail"}});

        expect(relay).not.toHaveBeenCalled();
    });

    it("forwards non-moderators when the list contains m", async () => {
        scenario = "all-messages";
        ignoreUsernames = "m";
        mockModerators("someone-else");

        await handleModmailTrigger({messageId: "message456", messageAuthor: {name: "alice"}});

        expect(relay).toHaveBeenCalledTimes(1);
    });

    it("forwards normally when the moderator lookup fails", async () => {
        scenario = "all-messages";
        ignoreUsernames = "m";
        getCurrentSubreddit.mockRejectedValue(new Error("boom"));

        await handleModmailTrigger({messageId: "message456", messageAuthor: {name: "alice"}});

        expect(relay).toHaveBeenCalledTimes(1);
    });

    describe("non-mod-replies scenario, against the real trigger payload", () => {
        // Captured from a live mod reply. Devvit sends the enum constant name, not the
        // bare "moderator" value the proto comment documents.
        function realModmailEvent(overrides: Record<string, unknown> = {}) {
            return {
                messageAuthor: {
                    id: "t2_o77bz",
                    name: "Lil_SpazJoekp",
                    url: "https://www.reddit.com/user/Lil_SpazJoekp",
                    accountType: 1,
                },
                createdAt: "2026-11-13T18:17:46.430Z",
                messageAuthorType: "ParticipatingAs_MODERATOR",
                conversationState: "inprogress",
                conversationType: "sr_user",
                isAutoGenerated: false,
                conversationSubreddit: {id: "t5_7ss0q", name: "Lil_SpazJoekp"},
                conversationId: "ModmailConversation_3v8ty0",
                messageId: "ModmailMessage_5jta54",
                type: "ModMail",
                ...overrides,
            };
        }

        beforeEach(() => {
            scenario = "non-mod-replies";
        });

        it("does not relay a moderator reply", async () => {
            await handleModmailTrigger(realModmailEvent());

            expect(relay).not.toHaveBeenCalled();
        });

        it("does not relay a hidden moderator reply", async () => {
            // a hidden reply carries the identical author type
            await handleModmailTrigger(realModmailEvent({messageId: "ModmailMessage_5jta66"}));

            expect(relay).not.toHaveBeenCalled();
        });

        it.each([
            "ParticipatingAs_PARTICIPANT_USER",
            "participant_user",
            "ParticipatingAs_PARTICIPANT_SR",
            "participant_sr",
            "",
        ])("relays a reply whose author type is %s", async (messageAuthorType) => {
            await handleModmailTrigger(realModmailEvent({messageAuthorType}));

            expect(relay).toHaveBeenCalledTimes(1);
        });

        it.each([
            "ParticipatingAs_MODERATOR",
            "participatingas_moderator",
            "moderator",
            "MODERATOR",
            "  ParticipatingAs_MODERATOR  ",
        ])("treats author type %s as a moderator", async (messageAuthorType) => {
            await handleModmailTrigger(realModmailEvent({messageAuthorType}));

            expect(relay).not.toHaveBeenCalled();
        });
    });


    describe("new-threads scenario, against the real trigger payload", () => {
        // Captured from a live new thread opened by a non-moderator. Note conversationState
        // is "appeals", not "new": nothing in the payload marks this as a new thread.
        function newThreadEvent(overrides: Record<string, unknown> = {}) {
            return {
                messageAuthor: {id: "t2_75u2lqkb", name: "Lil_SpazTest"},
                createdAt: "2026-11-13T18:22:43.639Z",
                messageAuthorType: "ParticipatingAs_PARTICIPANT_USER",
                conversationState: "appeals",
                conversationType: "sr_user",
                isAutoGenerated: false,
                conversationSubreddit: {id: "t5_7ss0q", name: "Lil_SpazJoekp"},
                conversationId: "ModmailConversation_3v8uqo",
                messageId: "ModmailMessage_5jtapu",
                type: "ModMail",
                ...overrides,
            };
        }

        beforeEach(() => {
            scenario = "new-threads";
        });

        it("relays the first message of a conversation", async () => {
            getConversation.mockResolvedValue({conversation: {id: "3v8uqo", numMessages: 1}} as never);

            await handleModmailTrigger(newThreadEvent());

            expect(relay).toHaveBeenCalledTimes(1);
        });

        it("does not relay a later reply in the same conversation", async () => {
            getConversation.mockResolvedValue({conversation: {id: "3v8uqo", numMessages: 4}} as never);

            await handleModmailTrigger(newThreadEvent());

            expect(relay).not.toHaveBeenCalled();
        });

        it("looks the conversation up exactly once and reuses it for the relay", async () => {
            getConversation.mockResolvedValue({conversation: {id: "3v8uqo", numMessages: 1}} as never);

            await handleModmailTrigger(newThreadEvent());

            expect(getConversation).toHaveBeenCalledExactlyOnceWith({
                conversationId: "3v8uqo",
                markRead: false,
            });
        });

        it("does not look the conversation up when no destination matches", async () => {
            getConfiguredDestinations.mockResolvedValue([]);

            await handleModmailTrigger(newThreadEvent());

            expect(getConversation).not.toHaveBeenCalled();
            expect(relay).not.toHaveBeenCalled();
        });

        it("does not relay when the conversation lookup gives no message count", async () => {
            getConversation.mockRejectedValue(new Error("Modmail unavailable"));

            await handleModmailTrigger(newThreadEvent());

            expect(relay).not.toHaveBeenCalled();
        });
    });


});
