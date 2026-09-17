import {reddit} from "@devvit/web/server";

import {getDestinations, isBucketEnabled} from "../services/destinations.js";
import {buildModmailMessage} from "../services/messages.js";
import {relayToDestinations} from "../services/relay.js";
import {asRecord, getString} from "../utils/records.js";
import {getStringSetting} from "../utils/settings.js";
import {REDDIT_THING_ID_PREFIX_PATTERN} from "../constants.js";

export async function handleModmailTrigger(event: unknown) {
    if (!await isBucketEnabled("modmail")) {
        return;
    }

    if (!await shouldSendModmail(event)) {
        return;
    }

    const destinations = await getDestinations("modmail");
    if (destinations.length === 0) {
        return;
    }

    const enrichedEvent = await enrichModmailEvent(event);
    const record = asRecord(enrichedEvent);
    await relayToDestinations({
        bucket: "modmail",
        destinations,
        message: buildModmailMessage(enrichedEvent),
        uniqueId: getString(record, "messageId") || getString(asRecord(record.message), "id") || getString(record, "id") || `${Date.now()}`,
    });
}

async function shouldSendModmail(event: unknown) {
    const record = asRecord(event);
    const conversation = asRecord(record.conversation);
    const message = asRecord(record.message);
    const author = asRecord(message.author ?? record.author ?? record.messageAuthor);

    if (getString(asRecord(record.action), "actionType") || getString(record, "actionType")) {
        return false;
    }

    const scenario = await getStringSetting("modmail-scenario", "new-threads");
    if (scenario === "all-messages") {
        return true;
    }

    const isModerator = (getString(author, "type") || getString(record, "authorType") || getString(record, "messageAuthorType")).toLowerCase() === "moderator"
        || author.isMod === true;
    if (scenario === "non-mod-replies") {
        return !isModerator;
    }

    return record.isNew === true
        || record.isNewThread === true
        || record.isNewConversation === true
        || conversation.numMessages === 1;
}

async function enrichModmailEvent(event: unknown) {
    const record = asRecord(event);
    const conversationId = getString(record, "conversationId") || getString(asRecord(record.conversation), "id");
    if (!conversationId) {
        return event;
    }

    try {
        const response = await reddit.modMail.getConversation({
            conversationId: stripModmailIdPrefix(conversationId),
            markRead: false,
        });
        const responseRecord = asRecord(response);
        const fetchedConversation = asRecord(response.conversation);
        const fetchedMessage = getFetchedModmailMessage(fetchedConversation, responseRecord, record);
        const conversation = withFallbackStringFields(asRecord(record.conversation), fetchedConversation, ["id", "subject"]);
        const message = withFallbackStringFields(asRecord(record.message), fetchedMessage, ["id", "body", "bodyMarkdown", "date"]);

        return {
            ...record,
            conversation,
            message,
            subject: getString(record, "subject") || getString(fetchedConversation, "subject"),
            body: getString(record, "body") || getString(fetchedMessage, "body") || getString(fetchedMessage, "bodyMarkdown"),
        };
    } catch (err) {
        console.log(`Failed to enrich modmail event ${conversationId}: ${err instanceof Error ? err.message : String(err)}`);
        return event;
    }
}

function getFetchedModmailMessage(
    conversation: Record<string, unknown>,
    response: Record<string, unknown>,
    event: Record<string, unknown>,
) {
    const messages = {
        ...asRecord(response.messages),
        ...asRecord(conversation.messages),
    };
    const messageId = getString(event, "messageId") || getString(asRecord(event.message), "id");
    if (!messageId) {
        return {};
    }

    const normalizedMessageId = stripModmailIdPrefix(messageId);
    return asRecord(messages[messageId]
        ?? messages[normalizedMessageId]
        ?? messages[`ModmailMessage_${normalizedMessageId}`]);
}

function withFallbackStringFields(record: Record<string, unknown>, fallback: Record<string, unknown>, fields: string[]) {
    const result = {
        ...fallback,
        ...record,
    };
    for (const field of fields) {
        if (!getString(result, field)) {
            const fallbackValue = getString(fallback, field);
            if (fallbackValue) {
                result[field] = fallbackValue;
            }
        }
    }
    return result;
}

function stripModmailIdPrefix(id: string) {
    return id.replace(REDDIT_THING_ID_PREFIX_PATTERN, "");
}
