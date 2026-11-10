import {
    AttributeIds,
    ClientSession,
    DataValue,
    DataTypeIds,
    LocalizedText,
    QualifiedName,
    ReadValueIdOptions,
    StatusCodes,
    Variant,
} from "node-opcua";
import { isStatusCodeGoodish } from "./ua-helper";
import { log } from "./config";

/*
 * Read helpers with tolerant struct decoding.
 *
 * OPC 40001-1/-2/-3 put a lot of information into structures (`Range`, `EUInformation`,
 * `EnumValueType[]`, the ISA-95 job data types) and into LocalizedText / QualifiedName values.
 * node-opcua decodes the well-known structures but vendor namespaces may deliver anything, so every
 * decoder here degrades to a raw representation instead of throwing: a demo client that crashes on an
 * unexpected structure is worse than one that reports the raw value.
 */

export type DecodedValue = {
    nodeId: string
    attributeId: number
    ok: boolean
    statusCode: string
    /* decoded value (null when the read failed or the value is null) */
    value: any
    /* raw decoded value before normalization, kept for debugging foreign namespaces */
    raw: any
    dataType: string
    valueRank: number
    arrayDimensions: number[] | null
    sourceTimestamp: Date | null
    statusCodeIsUncertain: boolean
}

const dataTypeNames = new Map<number, string>([
    [DataTypeIds.Boolean, "Boolean"],
    [DataTypeIds.Byte, "Byte"],
    [DataTypeIds.SByte, "SByte"],
    [DataTypeIds.Int16, "Int16"],
    [DataTypeIds.UInt16, "UInt16"],
    [DataTypeIds.Int32, "Int32"],
    [DataTypeIds.UInt32, "UInt32"],
    [DataTypeIds.Int64, "Int64"],
    [DataTypeIds.UInt64, "UInt64"],
    [DataTypeIds.Float, "Float"],
    [DataTypeIds.Double, "Double"],
    [DataTypeIds.String, "String"],
    [DataTypeIds.DateTime, "DateTime"],
    [DataTypeIds.Guid, "Guid"],
    [DataTypeIds.ByteString, "ByteString"],
    [DataTypeIds.XmlElement, "XmlElement"],
    [DataTypeIds.NodeId, "NodeId"],
    [DataTypeIds.QualifiedName, "QualifiedName"],
    [DataTypeIds.LocalizedText, "LocalizedText"],
    [DataTypeIds.Structure, "Structure"],
    [DataTypeIds.EUInformation, "EUInformation"],
    [DataTypeIds.Range, "Range"],
    [DataTypeIds.EnumValueType, "EnumValueType"],
    [DataTypeIds.Number, "Number"],
])

export function dataTypeName(dataTypeId: number): string {
    return dataTypeNames.get(dataTypeId) ?? `ns=0;i=${dataTypeId}`
}

/* node-opcua hands UInt64/Int64 back as UInt64 objects or [high, low] pairs. */
function toNumber(value: any): number | null {
    if (value === null || value === undefined) return null
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "bigint") return Number(value)
    if (Array.isArray(value) && value.length === 2) {
        const low = Number(value[0])
        const high = Number(value[1])
        if (Number.isFinite(low) && Number.isFinite(high)) return high * 0x100000000 + low
        return null
    }
    if (typeof value === "object") {
        if (typeof value.toNumber === "function") {
            try { return Number(value.toNumber()) } catch { return null }
        }
        if (Array.isArray(value.value)) return toNumber(value.value)
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function isPlainObject(value: any): boolean {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value)
}

/*
 * Servers and vendor namespaces deliver LocalizedText / QualifiedName either as the node-opcua class
 * or as a plain {locale,text} / {namespaceIndex,name} object. Both have to collapse to the readable
 * part, otherwise every Identification value ends up as a nested object in output.json.
 */
function collapseNamedText(value: any): string | null | undefined {
    if (value instanceof LocalizedText) return value.text ?? null
    /* a BrowseName is spec-written as "<namespaceIndex>:<name>", keep that prefix */
    if (value instanceof QualifiedName) return `${value.namespaceIndex}:${value.name}`
    if (!isPlainObject(value)) return undefined
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === "text") return value.text ?? null
    if (keys.length === 2 && keys.includes("locale") && keys.includes("text")) return value.text ?? null
    if (keys.length === 2 && keys.includes("namespaceIndex") && keys.includes("name")) return `${value.namespaceIndex}:${value.name}`
    if (keys.length === 3 && keys.includes("namespaceIndex") && keys.includes("name") && keys.includes("locale")) return `${value.namespaceIndex}:${value.name}`
    return undefined
}

/* LocalizedText / QualifiedName / DateTime / Buffer / UInt64 -> JSON friendly scalar. */
function normalizeScalar(value: any): any {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return value.toString("hex")
    if (typeof value === "bigint") return Number(value)
    const namedText = collapseNamedText(value)
    if (namedText !== undefined) return namedText
    return value
}

export function normalizeValue(value: any): any {
    if (value === null || value === undefined) return null
    if (Array.isArray(value)) return value.map((item) => normalizeScalar(item))
    if (isPlainObject(value)) {
        const namedText = collapseNamedText(value)
        if (namedText !== undefined) return namedText
        const out: Record<string, any> = {}
        for (const key of Object.keys(value)) {
            const entry = (value as any)[key]
            out[key] = entry === null || entry === undefined ? null : normalizeValue(entry)
        }
        return out
    }
    return normalizeScalar(value)
}

/* `Range` structure as used by EURange / InstrumentRange (OPC 10000-8). */
export type RangeValue = { low: number | null; high: number | null }

export function decodeRange(value: any): RangeValue | null {
    if (value === null || value === undefined) return null
    if (Array.isArray(value) && value.length >= 2) {
        return { low: toNumber(value[0]), high: toNumber(value[1]) }
    }
    if (isPlainObject(value)) {
        const low = toNumber((value as any).low ?? (value as any).Low)
        const high = toNumber((value as any).high ?? (value as any).High)
        if (low === null && high === null) return null
        return { low, high }
    }
    const single = toNumber(value)
    if (single !== null) return { low: single, high: single }
    return null
}

/* `EUInformation` structure as used by EngineeringUnits (OPC 10000-8). */
export type EUInformationValue = {
    namespaceUri: string | null
    unitId: number | null
    displayName: string | null
    displayUnit: string | null
    /* Fallback when the server sends something unexpected. */
    raw?: any
}

export function decodeEUInformation(value: any): EUInformationValue | null {
    if (value === null || value === undefined) return null
    if (isPlainObject(value)) {
        const entry = value as any
        const decoded: EUInformationValue = {
            namespaceUri: entry.namespaceUri === undefined || entry.namespaceUri === null ? null : `${entry.namespaceUri}`,
            unitId: toNumber(entry.unitId),
            displayName: entry.displayName === undefined || entry.displayName === null ? null : normalizeScalar(entry.displayName),
            displayUnit: entry.displayUnit === undefined || entry.displayUnit === null ? null : normalizeScalar(entry.displayUnit),
        }
        if (decoded.namespaceUri === null && decoded.unitId === null && decoded.displayName === null && decoded.displayUnit === null) {
            return { namespaceUri: null, unitId: null, displayName: null, displayUnit: null, raw: normalizeValue(value) }
        }
        return decoded
    }
    return { namespaceUri: null, unitId: null, displayName: null, displayUnit: null, raw: normalizeScalar(value) }
}

/* `EnumValueType[]` as used by MultiStateValueDiscreteType (OPC 40001-2 Status / AlarmSuppression). */
export type EnumValueEntry = {
    value: number | null
    valueName: string | null
    displayName: string | null
    description: string | null
}

export function decodeEnumValues(value: any): EnumValueEntry[] | null {
    if (value === null || value === undefined) return null
    const entries = Array.isArray(value) ? value : [value]
    const decoded: EnumValueEntry[] = []
    for (const entry of entries) {
        if (entry === null || entry === undefined) continue
        if (isPlainObject(entry)) {
            const item = entry as any
            const displayName = item.displayName === undefined ? null : normalizeScalar(item.displayName)
            decoded.push({
                value: toNumber(item.value),
                valueName: item.valueName === undefined || item.valueName === null ? null : normalizeScalar(item.valueName),
                displayName,
                description: item.description === undefined || item.description === null ? null : normalizeScalar(item.description),
            })
            continue
        }
        const numeric = toNumber(entry)
        if (numeric !== null) {
            decoded.push({ value: numeric, valueName: null, displayName: null, description: null })
        }
    }
    return decoded.length === 0 ? null : decoded
}

export function decodeDataValue(nodeId: string, attributeId: number, dataValue: DataValue): DecodedValue {
    const ok = isStatusCodeGoodish(dataValue.statusCode)
    const variant: Variant = dataValue.value ?? new Variant()
    const raw = variant.value
    /* node-opcua's Variant exposes arrayType (Scalar/Array/Matrix) and dimensions, not ValueRank. */
    const isArrayValue = Array.isArray(raw)
    return {
        nodeId,
        attributeId,
        ok,
        statusCode: `${dataValue.statusCode.name ?? dataValue.statusCode.toString()}`,
        value: ok || dataValue.statusCode.value === StatusCodes.UncertainLastUsableValue.value ? normalizeValue(raw) : null,
        raw: normalizeValue(raw),
        dataType: dataTypeName(variant.dataType?.valueOf?.() ?? 0),
        valueRank: isArrayValue ? (variant.dimensions && variant.dimensions.length > 1 ? 2 : 1) : -1,
        arrayDimensions: variant.dimensions ?? null,
        sourceTimestamp: dataValue.sourceTimestamp ?? null,
        statusCodeIsUncertain: !ok && dataValue.statusCode.value !== StatusCodes.Bad.value && `${dataValue.statusCode.name}`.startsWith("Uncertain"),
    }
}

/* Batch read of one attribute over many nodes. Preserves the caller's order. */
export async function readAttributeOfMany(session: ClientSession, nodeIds: string[], attributeId: AttributeIds = AttributeIds.Value): Promise<DecodedValue[]> {
    if (nodeIds.length === 0) return []
    const readResults: DataValue[] = await session.read(nodeIds.map((nodeId) => {
        return { nodeId, attributeId } as ReadValueIdOptions
    }))
    return readResults.map((dataValue, index) => decodeDataValue(nodeIds[index], attributeId, dataValue))
}

export async function readValue(session: ClientSession, nodeId: string): Promise<DecodedValue> {
    const dataValue: DataValue = await session.read({ nodeId, attributeId: AttributeIds.Value } as ReadValueIdOptions)
    return decodeDataValue(nodeId, AttributeIds.Value, dataValue)
}

/*
 * Read several attributes of one node in a single round trip.
 * Returns the results in the same order as the requested attribute ids.
 */
export async function readAttributes(session: ClientSession, nodeId: string, attributeIds: AttributeIds[]): Promise<DecodedValue[]> {
    if (attributeIds.length === 0) return []
    const readResults: DataValue[] = await session.read(attributeIds.map((attributeId) => {
        return { nodeId, attributeId } as ReadValueIdOptions
    }))
    return readResults.map((dataValue, index) => decodeDataValue(nodeId, attributeIds[index], dataValue))
}

/* Log a failed read without treating it as an error: optional spec nodes legitimately fail. */
export function reportBadRead(nodeId: string, attributeId: number, decoded: DecodedValue, context: string): void {
    if (decoded.ok) return
    log.debug(`${context}: NodeId='${nodeId}' attribute='${attributeId}' statusCode='${decoded.statusCode}'`)
}
