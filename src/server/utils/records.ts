export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord {
    return value !== null && typeof value === "object" ? value as UnknownRecord : {};
}

export function getString(record: UnknownRecord, key: string, defaultValue = "") {
    const value = record[key];
    return typeof value === "string" ? value : defaultValue;
}

export function getNumber(record: UnknownRecord, key: string, defaultValue = 0) {
    const value = record[key];
    return typeof value === "number" ? value : defaultValue;
}

export function getBoolean(record: UnknownRecord, key: string, defaultValue = false) {
    const value = record[key];
    return typeof value === "boolean" ? value : defaultValue;
}

export function getDateString(value: unknown) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }
    return new Date().toISOString();
}

export function stringifyValue(value: unknown): string {
    if (value === undefined || value === null || value === "") {
        return "";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}
