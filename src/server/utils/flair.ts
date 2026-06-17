import type {FlairLike} from "../types.js";

export function matchesFlair(filterValues: string[], flair: FlairLike | undefined, flairMap: Map<string, string>) {
    return filterValues.includes(normalize(flair?.text))
        || filterValues.includes(flairMap.get(flair?.templateId || "") || "");
}

export function splitCsv(value: string) {
    return value
        .toLowerCase()
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

export function normalize(value: string | undefined) {
    return (value || "").toLowerCase();
}
