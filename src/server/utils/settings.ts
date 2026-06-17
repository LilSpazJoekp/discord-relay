import {settings} from "@devvit/web/server";

import {MINIMUM_DELAY} from "../constants.js";

export function validateDelay(inputValue = 0) {
    if (inputValue !== 0 && inputValue < MINIMUM_DELAY) {
        return `Please enter a delay of at least ${MINIMUM_DELAY} minutes`;
    }
}

export async function getStringSetting(name: string, defaultValue = "") {
    const value = firstSettingValue(await settings.get(name));
    return typeof value === "string" ? value : defaultValue;
}

export async function getBooleanSetting(name: string, defaultValue = false) {
    const value = firstSettingValue(await settings.get(name));
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return value.toLowerCase() === "true";
    }
    return defaultValue;
}

export async function getNumberSetting(name: string, defaultValue = 0) {
    const value = firstSettingValue(await settings.get(name));
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : defaultValue;
    }
    return defaultValue;
}

function firstSettingValue(value: unknown) {
    return Array.isArray(value) ? value[0] : value;
}
