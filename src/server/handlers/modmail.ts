import {reddit} from "@devvit/web/server";

import {getDestinations, isBucketEnabled} from "../services/destinations.js";
import {buildModmailMessage} from "../services/messages.js";
import {relayToDestinations} from "../services/relay.js";
import {isIgnoredAuthor} from "../services/ignoredAuthors.js";
import {asRecord, getString} from "../utils/records.js";
import {getStringSetting} from "../utils/settings.js";
import {REDDIT_THING_ID_PREFIX_PATTERN} from "../constants.js";

export async function handleModmailTrigger(event: unknown) {
    if (!await isBucketEnabled("modmail")) {
        return;
    }

    // Both are resolved at most once, and only when something actually needs them, so a
    // filtered-out event costs no settings reads and no conversation lookup.
    let destinationsPromise: ReturnType<typeof getDestinations> | undefined;
    const loadDestinations = () => (destinationsPromise ??= getDestinations("modmail"));
    let enrichment: Promise<unknown> | undefined;
    const enrich = () => (enrichment ??= enrichModmailEvent(event));

    if (!await shouldSendModmail(event, {enrich, loadDestinations})) {
        return;
    }

    const destinations = await loadDestinations();
    if (destinations.length === 0) {
        return;
    }

    const enrichedEvent = await enrich();
    const record = asRecord(enrichedEvent);
    await relayToDestinations({
        bucket: "modmail",
        destinations,
        message: buildModmailMessage(enrichedEvent),
        uniqueId: getString(record, "messageId") || getString(asRecord(record.message), "id") || getString(record, "id") || `${Date.now()}`,
    });
}

async function shouldSendModmail(
    event: unknown,
    {enrich, loadDestinations}: {
        enrich: () => Promise<unknown>;
        loadDestinations: () => ReturnType<typeof getDestinations>;
    },
) {
    const record = asRecord(event);
    const conversation = asRecord(record.conversation);
    const message = asRecord(record.message);
    const author = asRecord(message.author ?? record.author ?? record.messageAuthor);

    if (getString(asRecord(record.action), "actionType") || getString(record, "actionType")) {
        return false;
    }

    const authorType = getString(author, "type")
        || getString(record, "authorType")
        || getString(record, "messageAuthorType");
    const isModerator = normalizeAuthorType(authorType) === "moderator" || author.isMod === true;
    const authorName = getString(author, "name")
        || getString(author, "username")
        || getString(record, "author")
        || getString(record, "messageAuthor");

    // Applies to every scenario: an ignored author is never forwarded.
    if (await isIgnoredAuthor(authorName, {isModerator, additionalSettingName: "modmail-ignore-usernames"})) {
        console.log(`Not relaying modmail from ignored author: ${authorName || "(unknown)"}`);
        return false;
    }

    const scenario = await getStringSetting("modmail-scenario", "new-threads");
    if (scenario === "all-messages") {
        return true;
    }

    if (scenario === "non-mod-replies") {
        return !isModerator;
    }

    // Nothing in the trigger payload distinguishes a new thread from a reply, so this is
    // the one scenario that has to look the conversation up for its numMessages. Skip
    // that call when there is nowhere to relay to.
    if ((await loadDestinations()).length === 0) {
        return false;
    }
    const fetched = asRecord(asRecord(await enrich()).conversation);
    const numMessages = typeof fetched.numMessages === "number" ? fetched.numMessages : conversation.numMessages;
    if (typeof numMessages === "number") {
        return numMessages === 1;
    }
    return record.isNew === true
        || record.isNewThread === true
        || record.isNewConversation === true;
}

/**
 * The trigger sends the enum constant name, e.g. "ParticipatingAs_MODERATOR", while the
 * proto documents the bare value "moderator". Normalising the prefix away accepts both,
 * and still excludes PARTICIPANT_USER and PARTICIPANT_SR (a moderator of the *other*
 * subreddit in an sr_sr conversation, who is not a moderator here).
 */
function normalizeAuthorType(value: string) {
    return value.trim().toLowerCase().replace(/^participatingas_/, "");
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
