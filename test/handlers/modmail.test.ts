import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    reddit: {
        modMail: {
            getConversation: vi.fn(),
        },
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
let scenario: string;

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
        vi.mocked(settings.get).mockImplementation(async (name) => name === "modmail-scenario" ? scenario : undefined);

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
});
