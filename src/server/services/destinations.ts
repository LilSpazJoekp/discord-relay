import type {DestinationEvent, ItemType, RelayBucket, RelayDestination} from "../types.js";
import {getBooleanSetting, getStringArraySetting, getStringSetting} from "../utils/settings.js";

const DESTINATION_COUNT = 6;

export async function getDestinations(bucket: RelayBucket, itemType?: ItemType): Promise<RelayDestination[]> {
    if (!await isBucketEnabled(bucket)) {
        return [];
    }

    const configured: RelayDestination[] = [];
    for (let index = 1; index <= DESTINATION_COUNT; index += 1) {
        if (!await getBooleanSetting(`destination-${index}-enabled`, true)) {
            continue;
        }
        const webhookUrl = await getStringSetting(`destination-${index}-url`);
        if (!webhookUrl) {
            continue;
        }
        const events = (await getStringArraySetting(`destination-${index}-events`)) as DestinationEvent[];
        if (destinationMatches(events, bucket, itemType)) {
            configured.push({
                id: `destination-${index}`,
                webhookUrl,
                events,
            });
        }
    }

    if (configured.length > 0 || bucket !== "unmoderated") {
        return configured;
    }

    const legacyWebhookUrl = await getStringSetting("webhook-url");
    return legacyWebhookUrl
        ? [{
            id: "legacy-webhook-url",
            webhookUrl: legacyWebhookUrl,
            events: ["unmoderated"],
        }]
        : [];
}

function destinationMatches(events: DestinationEvent[], bucket: RelayBucket, itemType?: ItemType) {
    return events.includes("all")
        || events.includes(bucket)
        || (itemType !== undefined && events.includes(itemType));
}

export async function isBucketEnabled(bucket: RelayBucket) {
    return getBooleanSetting(`${bucket}-enabled`, bucket === "unmoderated");
}
