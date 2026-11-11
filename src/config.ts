import { UserIdentityInfo, UserTokenType } from "node-opcua";

/*
 * All runtime configuration comes from the environment. Nothing is hardcoded in the entrypoint,
 * so the same build can be pointed at a demo server, a lab server or a local test server.
 */

const toNumber = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value.trim().length === 0) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const toString = (value: string | undefined, fallback: string): string => {
    if (value === undefined || value.trim().length === 0) return fallback;
    return value.trim();
}

export type AppConfig = {
    endpoint: string
    userIdentity: UserIdentityInfo
    port: number
    outputFile: string
    /* snapshot refresh / address-space re-scan */
    refreshIntervalMs: number
    rescanIntervalMs: number
    /* subscription tuning */
    publishingIntervalMs: number
    samplingIntervalMs: number
    serverSamplingIntervalMs: number
    /* monitored-item capacity: keep slack below MaxMonitoredItemsPerSubscription */
    subscriptionSlack: number
    maxMonitoredItemsPerRequest: number
    /* debounce for model-change-event triggered re-scans */
    modelChangeRescanDebounceMs: number
    requestTimeoutMs: number
    initRetryDelayMs: number
    logLevel: "debug" | "info" | "warn" | "error"
}

const logLevelRaw = toString(process.env.LOG_LEVEL, "info").toLowerCase();
const logLevel: AppConfig["logLevel"] =
    logLevelRaw === "debug" || logLevelRaw === "warn" || logLevelRaw === "error" ? logLevelRaw : "info";

const userIdentity: UserIdentityInfo = process.env.OPCUA_USERNAME
    ? { type: UserTokenType.UserName, userName: process.env.OPCUA_USERNAME, password: process.env.OPCUA_PASSWORD ?? "" }
    : { type: UserTokenType.Anonymous };

export const config: AppConfig = {
    endpoint: toString(process.env.OPCUA_ENDPOINT, "opc.tcp://opcua.umati.app:4843"),
    userIdentity,
    port: toNumber(process.env.PORT, 3000),
    outputFile: toString(process.env.OUTPUT_FILE, "output.json"),
    refreshIntervalMs: toNumber(process.env.REFRESH_INTERVAL_MS, 10_000),
    rescanIntervalMs: toNumber(process.env.RESCAN_INTERVAL_MS, 60_000),
    publishingIntervalMs: toNumber(process.env.PUBLISHING_INTERVAL_MS, 5_000),
    samplingIntervalMs: toNumber(process.env.SAMPLING_INTERVAL_MS, 2_000),
    serverSamplingIntervalMs: toNumber(process.env.SERVER_SAMPLING_INTERVAL_MS, 5_000),
    subscriptionSlack: toNumber(process.env.SUBSCRIPTION_SLACK, 10),
    maxMonitoredItemsPerRequest: toNumber(process.env.MAX_MONITORED_ITEMS_PER_REQUEST, 500),
    modelChangeRescanDebounceMs: toNumber(process.env.MODEL_CHANGE_RESCAN_DEBOUNCE_MS, 5_000),
    requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 30 * 60 * 1000),
    initRetryDelayMs: toNumber(process.env.INIT_RETRY_DELAY_MS, 10_000),
    logLevel,
};

export const log = {
    debug: (...args: unknown[]) => { if (config.logLevel === "debug") console.log(...args) },
    info: (...args: unknown[]) => { if (config.logLevel === "debug" || config.logLevel === "info") console.log(...args) },
    warn: (...args: unknown[]) => { if (config.logLevel !== "error") console.warn(...args) },
    error: (...args: unknown[]) => console.error(...args),
}
