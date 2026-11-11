import {
    AttributeIds,
    ClientSession,
    DataValue,
    NodeClass,
    ReferenceTypeIds,
} from "node-opcua";
import { log } from "./config";
import { browseChildByBrowseName, browseComponents, browseProperties, isMethodNode, isObjectNode, isVariableNode, UaRef } from "./ua-browse";
import {
    decodeEnumValues,
    decodeEUInformation,
    decodeRange,
    EnumValueEntry,
    normalizeValue,
    readAttributeOfMany,
    readAttributes,
} from "./ua-read";
import { TypeMatch, UaTypeResolver } from "./ua-types";
import {
    ANALOG_SIGNAL_CHILDREN,
    ANALOG_SIGNAL_PROPERTIES,
    PROCESS_VALUE_ALARM_SUPPRESSION_ENUMS,
    PROCESS_VALUE_CHILDREN,
    PROCESS_VALUE_DEVIATION_SENSITIVITY_ENUMS,
    PROCESS_VALUE_STATUS_ENUMS,
    PROCESS_VALUE_TYPES,
    ProcessValueChildSpec,
    SETPOINT_CHILDREN,
} from "./ua-spec-processvalues";

export class dataStoreItem {

    private nodeId: string
    private displayName: string | null
    private browseName: string | null
    private description: string | null
    private value: DataValue = new DataValue()

    constructor(nodeId: string, displayName: string | null, browseName: string | null, description: string | null) {
        this.nodeId = nodeId
        this.displayName = displayName
        this.browseName = browseName
        this.description = description
    }

    updateValue(dataValue: DataValue) {
        if (this.value.value.value === dataValue.value.value) return
        console.log(`OPC UA Client: DataChange nodeId='${this.nodeId}' displayName='${this.displayName}' browseName='${this.browseName}' value='${JSON.stringify(normalizeValue(dataValue.value.value))}'`)
        this.value = dataValue
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            DisplayName: this.displayName,
            BrowseName: this.browseName,
            Description: this.description,
            Value: normalizeValue(this.value.value.value),
            StatusCode: `${this.value.statusCode.name ?? this.value.statusCode.toString()}`,
            SourceTimestamp: this.value.sourceTimestamp ?? null,
        }
    }
}

/*
 * OPC 40001-2 7.1 (Tables 1-4) and 9.1 (Table 6): one discovered child of a ProcessValueType instance.
 *
 * Classification is registry-driven (ua-spec-processvalues.ts): a child matches when its BrowseName
 * matches a declared spec child AND - if the spec declares a TypeDefinition for it - its HasSubtype
 * chain reaches that type. `specMatch` records both parts; a child with a spec BrowseName but a vendor
 * TypeDefinition stays recorded with specMatch=false (server deviation, not coverage), and children the
 * spec does not declare at all stay visible with specEntry=null instead of being dropped.
 */

/* Registry entry the child matched, copied so the output is self-contained. */
export type ProcessValueSpecEntry = {
    browseName: string
    reference: string
    nodeClass: string
    occurrence: string
    feature: string
    clause: string
}

/* Standardized EnumValues (OPC 40001-2 Table 3 / Table 7), keyed by the child's BrowseName. */
const ENUM_VALUE_TABLES: Record<string, Record<number, string>> = {
    Status: PROCESS_VALUE_STATUS_ENUMS,
    AlarmSuppression: PROCESS_VALUE_ALARM_SUPPRESSION_ENUMS,
    DeviationSensitivity: PROCESS_VALUE_DEVIATION_SENSITIVITY_ENUMS,
}

export type ProcessValueChild = {
    nodeId: string
    browseName: string
    displayName: string | null
    description: string | null
    nodeClass: string
    /* PV instance, AnalogSignal Variable or ProcessValueSetpoint Variable the child hangs under */
    parentNodeId: string
    /* how the child was reached (spec reference is in specEntry; a difference is a deviation) */
    reference: string
    specEntry: ProcessValueSpecEntry | null
    /* BrowseName matched AND (no spec TypeRef declared OR chain reaches it) */
    specMatch: boolean
    typeDefinition: string | null
    typeDefinitionChain: string
    /* decoded Value / EURange / EngineeringUnits / EnumValues of that child */
    value: any
    range: { low: number | null; high: number | null } | null
    engineeringUnits: { namespaceUri: string | null; unitId: number | null; displayName: string | null; displayUnit: string | null } | null
    /* server EnumValues Property (OPC 10000-8 MultiStateValueDiscrete), if the server provides one */
    enumValues: EnumValueEntry[] | null
    /* standardized spec table (40001-2 Table 3 / Table 7) for this child's BrowseName */
    specEnumValues: Record<number, string> | null
    /* human-readable label of the current numeric value (spec enum or server EnumValues) */
    valueName: string | null
    statusCode: string
    feature: string | null
}

/* Table 1 'DeviationAlarm' / 'LimitAlarm' Objects (OPC 10000-9 alarm instances). */
export type ProcessValueAlarm = {
    nodeId: string
    browseName: string
    displayName: string | null
    specEntry: ProcessValueSpecEntry | null
    specMatch: boolean
    typeDefinition: string | null
    typeDefinitionChain: string
    /* direct Variable/Object children read once at discovery; alarm state is event based, never subscribed */
    children: { nodeId: string; browseName: string; displayName: string | null; nodeClass: string; value: any; statusCode: string | null }[]
}

/* Table 1 'ZeroPointAdjustment' (Table 4: it raises a ZeroPointAdjustmentEventType). */
export type ProcessValueMethod = {
    nodeId: string
    browseName: string
    displayName: string | null
    specEntry: ProcessValueSpecEntry | null
    specMatch: boolean
    /* Argument / ArgumentDescription arrays of the Method's InputArgs / OutputArgs Properties */
    inputArgs: any | null
    outputArgs: any | null
    note: string
}

export class UaProcessValue {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly nodeId: string

    /**
     * Attributes of the ProcessValue-Instance-Object e.g. DisplayName, BrowseName and Description
     */
    readonly attributes: Map<string, any> = new Map()

    /**
     * Additional References of the ProcessValue-Instance-Object e.g. TypeDefinition
     */
    readonly references: Map<string, any> = new Map()

    /**
     * All discovered Variable-/Property children of the instance, keyed by canonical NodeId
     */
    readonly children: Map<string, ProcessValueChild> = new Map()

    /**
     * Table 1 alarm Objects (presence + state children), read once at discovery
     */
    readonly alarms: Map<string, ProcessValueAlarm> = new Map()

    /**
     * Table 1 Methods (ZeroPointAdjustment) - reported with their Arguments, never called (read-only client)
     */
    readonly methods: Map<string, ProcessValueMethod> = new Map()

    /**
     * dataStoreItem view kept for the DataChange fan-out and the REST shape
     */
    readonly _dataStore: Map<string, dataStoreItem> = new Map()

    /**
     * Last known initialization Date
     */
    _lastInitialization = new Date()

    /**
     * A Set of known NodeId's associated with this class-instance
     */
    _relatedNodeIds = new Set<string>()

    /**
     * A Set of known Variable-/Property-NodeId's associated with this class-instance
     */
    _relatedVariableNodeIds = new Set<string>()

    /**
     * The mandatory 3:AnalogSignal Variable (OPC 40001-2 7.1 Table 1)
     */
    _analogSignalNodeId: string | null = null

    /**
     * The mandatory 3:SignalTag Property (OPC 30081, inherited by OPC 40001-2 7.1)
     */
    _signalTagNodeId: string | null = null

    /**
     * The optional ProcessValueSetpoint Variable (OPC 40001-2 7.1 Table 1 / 9.1 Table 6)
     */
    _setpointNodeId: string | null = null

    constructor(session: ClientSession, nodeId: string, resolver: UaTypeResolver) {
        this.session = session
        this.nodeId = nodeId
        this.resolver = resolver
        this._relatedNodeIds.add(nodeId)
    }

    async initialize() {
        const attributes = await readAttributes(this.session, this.nodeId, [
            AttributeIds.DisplayName,
            AttributeIds.BrowseName,
            AttributeIds.Description,
        ])
        this.attributes.set("DisplayName", attributes[0].value)
        this.attributes.set("BrowseName", attributes[1].value)
        this.attributes.set("Description", attributes[2].value)
        await this.discoverMetaData()
        this._lastInitialization = new Date()
    }

    /*
     * TypeDefinition check through the HasSubtype chain (ua-types.ts).
     * It replaces the old DisplayName string comparison, so vendor subtypes of ProcessValueType are
     * accepted and `ChannelMonitoringType` and friends are rejected because they are not subtypes.
     * Throwing here is the contract: callers (ua-machine.ts loadProcessValue) report it as a warning
     * and skip the node.
     */
    private async classifyInstance(): Promise<void> {
        const match = await this.resolver.match(this.nodeId, [PROCESS_VALUE_TYPES.processValueType])
        const typeDefinition = match.typeDefinition
        this.references.set("TypeDefinition", typeDefinition?.browseName ?? typeDefinition?.displayName ?? null)
        this.references.set("TypeDefinitionChain", UaTypeResolver.formatChain(match.chain))
        if (match.typeDefinition !== null) {
            this._relatedNodeIds.add(match.chain[0].nodeId)
        }
        if (match.ref === undefined) {
            throw new Error(
                `NodeId='${this.nodeId}' with TypeDefinition='${typeDefinition?.browseName ?? "?"}' ` +
                `is not a subtype of 'ProcessValueType' [chain: ${UaTypeResolver.formatChain(match.chain)}] skipping node!`
            )
        }
    }

    async discoverMetaData() {
        await this.classifyInstance()
        /* HasComponent children: AnalogSignal, limits, setpoint, Status, alarms, Methods, ... */
        for (const child of await browseComponents(this.session, this.nodeId)) {
            await this.loadChild(child, PROCESS_VALUE_CHILDREN, this.nodeId, "HasComponent")
        }
        /* HasProperty children: SignalTag */
        for (const child of await browseProperties(this.session, this.nodeId)) {
            await this.loadChild(child, PROCESS_VALUE_CHILDREN, this.nodeId, "HasProperty")
        }
    }

    /*
     * Registry classification of one child: BrowseName decides which spec entry it is, the TypeDefinition
     * chain decides whether the server actually implements it with the spec TypeDefinition. The chain is
     * recorded either way, so a vendor substitution shows up in output.json.
     */
    private async loadChild(ref: UaRef, table: ProcessValueChildSpec[], parentNodeId: string, reference: string) {
        if (this.children.has(ref.nodeId)) return
        const specEntry = table.find((entry) => entry.browseName === ref.browseName) ?? null
        let match: TypeMatch | null = null
        if (specEntry !== null && specEntry.typeRefs.length > 0) {
            match = await this.resolver.match(ref.nodeId, specEntry.typeRefs)
        }
        const chain = match !== null ? match.chain : await this.resolver.chainOfNode(ref.nodeId)
        const typeDefinition = chain[0] ?? null
        const specMatch = specEntry === null
            ? false
            : specEntry.typeRefs.length === 0 || (match !== null && match.ref !== undefined)
        if (specEntry === null) {
            log.debug(`OPC UA Client: ProcessValue '${this.nodeId}' child '${ref.nodeId}' browseName='${ref.browseName}' TypeDefinition='${typeDefinition?.browseName ?? "?"}' is not a declared OPC 40001-2 child, kept as vendor extension`)
        } else if (!specMatch) {
            log.debug(`OPC UA Client: ProcessValue '${this.nodeId}' child '${ref.nodeId}' matches spec BrowseName '${specEntry.browseName}' but its chain '${UaTypeResolver.formatChain(chain)}' does not reach '${specEntry.typeRefs.map((typeRef) => typeRef.browseName).join("' or '")}'`)
        } else if (specEntry.reference !== reference) {
            log.debug(`OPC UA Client: ProcessValue '${this.nodeId}' child '${ref.nodeId}' is reached via '${reference}' but OPC 40001-2 declares it via '${specEntry.reference}'`)
        }

        const child: ProcessValueChild = {
            nodeId: ref.nodeId,
            browseName: ref.browseName,
            displayName: ref.displayName,
            description: null,
            nodeClass: NodeClass[ref.nodeClass] ?? String(ref.nodeClass),
            parentNodeId,
            reference,
            specEntry: specEntry === null ? null : {
                browseName: specEntry.browseName,
                reference: specEntry.reference,
                nodeClass: specEntry.nodeClass,
                occurrence: specEntry.occurrence,
                feature: specEntry.feature,
                clause: specEntry.clause,
            },
            specMatch,
            typeDefinition: typeDefinition?.browseName ?? null,
            typeDefinitionChain: UaTypeResolver.formatChain(chain),
            value: null,
            range: null,
            engineeringUnits: null,
            enumValues: null,
            specEnumValues: ENUM_VALUE_TABLES[ref.browseName] ?? null,
            valueName: null,
            statusCode: "Good",
            feature: specEntry?.feature ?? null,
        }
        this._relatedNodeIds.add(ref.nodeId)

        if (isVariableNode(ref.nodeClass)) {
            await this.loadVariableChild(child, specEntry)
            return
        }
        if (isObjectNode(ref.nodeClass)) {
            if (specEntry?.feature === "processValues.alarms") {
                this.children.set(ref.nodeId, child)
                await this.loadAlarmObject(ref, child)
            } else {
                log.debug(`OPC UA Client: ProcessValue '${this.nodeId}' Object child '${ref.nodeId}' browseName='${ref.browseName}' is not a declared alarm Object, skipped`)
            }
            return
        }
        if (isMethodNode(ref.nodeClass)) {
            await this.loadMethod(ref, specEntry)
            return
        }
        log.debug(`OPC UA Client: ProcessValue '${this.nodeId}' child '${ref.nodeId}' nodeClass='${child.nodeClass}' is not loadable, skipped`)
    }

    /*
     * Read Value + Description in one round trip and decode the AnalogUnit structures tolerantly
     * (ua-read.ts). A child that cannot be read is still recorded, only with its statusCode.
     */
    private async loadVariableChild(child: ProcessValueChild, specEntry: ProcessValueChildSpec | null) {
        const readResults = await readAttributes(this.session, child.nodeId, [AttributeIds.Value, AttributeIds.Description])
        const value = readResults[0]
        child.description = readResults[1].value
        child.value = value.value
        child.statusCode = value.statusCode

        if (child.browseName === "EURange" || child.browseName === "InstrumentRange") {
            child.range = decodeRange(value.raw)
        } else if (child.browseName === "EngineeringUnits") {
            child.engineeringUnits = decodeEUInformation(value.raw)
        }

        /* standardized EnumValues: spec table always, server EnumValues Property when it provides one */
        if (ENUM_VALUE_TABLES[child.browseName] !== undefined) {
            await this.loadEnumValuesProperty(child)
        }
        child.valueName = this.enumLabelOf(child)

        this.children.set(child.nodeId, child)

        const dataItem = new dataStoreItem(child.nodeId, child.displayName, child.browseName, child.description)
        dataItem.updateValue(new DataValue({ statusCode: child.statusCode, value: { value: value.raw } } as any))
        this._dataStore.set(child.nodeId, dataItem)
        if (value.statusCodeIsUncertain || value.ok) {
            this._relatedVariableNodeIds.add(child.nodeId)
        }

        if (child.browseName === "AnalogSignal" && this._analogSignalNodeId === null) {
            this._analogSignalNodeId = child.nodeId
            await this.loadSignalChildren(child.nodeId)
        }
        if (specEntry?.feature === "processValues.setpoint" && this._setpointNodeId === null) {
            this._setpointNodeId = child.nodeId
            await this.loadSetpointChildren(child.nodeId)
        }
        if (child.browseName === "SignalTag" && this._signalTagNodeId === null) {
            this._signalTagNodeId = child.nodeId
        }
    }

    /* Table 2 - limits / percentage / simulation below the AnalogSignal Variable. */
    private async loadSignalChildren(analogSignalNodeId: string) {
        for (const child of await browseComponents(this.session, analogSignalNodeId)) {
            await this.loadChild(child, ANALOG_SIGNAL_CHILDREN, analogSignalNodeId, "HasComponent")
        }
        /* EURange / EngineeringUnits / InstrumentRange / ValuePrecision are Properties of the AnalogSignal */
        for (const child of await browseProperties(this.session, analogSignalNodeId)) {
            await this.loadChild(child, ANALOG_SIGNAL_PROPERTIES, analogSignalNodeId, "HasProperty")
        }
    }

    /* Table 6 - deviation limits / substitute value / sensitivity below the ProcessValueSetpoint Variable. */
    private async loadSetpointChildren(setpointNodeId: string) {
        for (const child of await browseComponents(this.session, setpointNodeId)) {
            await this.loadChild(child, SETPOINT_CHILDREN, setpointNodeId, "HasComponent")
        }
        for (const child of await browseProperties(this.session, setpointNodeId)) {
            await this.loadChild(child, SETPOINT_CHILDREN, setpointNodeId, "HasProperty")
        }
    }

    /*
     * MultiStateValueDiscrete Variables declare their enum range as an EnumValues Property
     * (OPC 10000-8), NOT in their Value - the Value only holds the current numeric state.
     */
    private async loadEnumValuesProperty(child: ProcessValueChild) {
        const enumValuesRef = await browseChildByBrowseName(this.session, child.nodeId, "EnumValues", ReferenceTypeIds.HasProperty)
        if (enumValuesRef === null) return
        const decoded = (await readAttributes(this.session, enumValuesRef.nodeId, [AttributeIds.Value]))[0]
        child.enumValues = decodeEnumValues(decoded.raw)
        this._relatedNodeIds.add(enumValuesRef.nodeId)
        if (child.enumValues === null && !decoded.ok) {
            log.debug(`OPC UA Client: ProcessValue enum child '${enumValuesRef.nodeId}' read failed with '${decoded.statusCode}'`)
        }
    }

    /* Human-readable name of the child's current numeric enum value. */
    private enumLabelOf(child: ProcessValueChild): string | null {
        const numeric = typeof child.value === "number" ? child.value : null
        if (numeric === null) return null
        const serverEntry = child.enumValues?.find((entry) => entry.value === numeric)
        const serverLabel = serverEntry?.valueName ?? serverEntry?.displayName ?? null
        if (serverLabel !== null && serverLabel !== undefined) return serverLabel
        return child.specEnumValues?.[numeric] ?? null
    }

    /* Table 1 alarm Objects: presence + direct state children, read once (alarm state is event based). */
    private async loadAlarmObject(ref: UaRef, child: ProcessValueChild) {
        const alarm: ProcessValueAlarm = {
            nodeId: ref.nodeId,
            browseName: ref.browseName,
            displayName: ref.displayName,
            specEntry: child.specEntry,
            specMatch: child.specMatch,
            typeDefinition: child.typeDefinition,
            typeDefinitionChain: child.typeDefinitionChain,
            children: [],
        }
        this.alarms.set(ref.nodeId, alarm)
        const childRefs = [
            ...await browseComponents(this.session, ref.nodeId),
            ...await browseProperties(this.session, ref.nodeId),
        ]
        const variableRefs = childRefs.filter((childRef) => isVariableNode(childRef.nodeClass))
        const values = await readAttributeOfMany(this.session, variableRefs.map((childRef) => childRef.nodeId))
        const valueByNodeId = new Map<string, { value: any; statusCode: string }>()
        values.forEach((decoded, index) => valueByNodeId.set(variableRefs[index].nodeId, { value: decoded.value, statusCode: decoded.statusCode }))
        for (const alarmChild of childRefs) {
            this._relatedNodeIds.add(alarmChild.nodeId)
            const decoded = valueByNodeId.get(alarmChild.nodeId)
            alarm.children.push({
                nodeId: alarmChild.nodeId,
                browseName: alarmChild.browseName,
                displayName: alarmChild.displayName,
                nodeClass: NodeClass[alarmChild.nodeClass] ?? String(alarmChild.nodeClass),
                value: decoded?.value ?? null,
                statusCode: decoded?.statusCode ?? null,
            })
        }
    }

    /*
     * Table 1 Methods (ZeroPointAdjustment): the read-only client reports their existence and their
     * InputArgs / OutputArgs declarations, but never calls them.
     */
    private async loadMethod(ref: UaRef, specEntry: ProcessValueChildSpec | null) {
        if (specEntry === null) {
            log.debug(`OPC UA Client: ProcessValue '${this.nodeId}' Method child '${ref.nodeId}' browseName='${ref.browseName}' is not a declared OPC 40001-2 Method, kept as vendor extension`)
        }
        const method: ProcessValueMethod = {
            nodeId: ref.nodeId,
            browseName: ref.browseName,
            displayName: ref.displayName,
            specEntry: specEntry === null ? null : {
                browseName: specEntry.browseName,
                reference: specEntry.reference,
                nodeClass: specEntry.nodeClass,
                occurrence: specEntry.occurrence,
                feature: specEntry.feature,
                clause: specEntry.clause,
            },
            specMatch: specEntry !== null,
            inputArgs: null,
            outputArgs: null,
            note: "Method availability reported only - this client is read-only and never calls Methods",
        }
        this.methods.set(ref.nodeId, method)
        this._relatedNodeIds.add(ref.nodeId)
        const inputArgsRef = await browseChildByBrowseName(this.session, ref.nodeId, "InputArgs", ReferenceTypeIds.HasProperty)
        if (inputArgsRef !== null) {
            const decoded = (await readAttributes(this.session, inputArgsRef.nodeId, [AttributeIds.Value]))[0]
            method.inputArgs = decoded.value
        }
        const outputArgsRef = await browseChildByBrowseName(this.session, ref.nodeId, "OutputArgs", ReferenceTypeIds.HasProperty)
        if (outputArgsRef !== null) {
            const decoded = (await readAttributes(this.session, outputArgsRef.nodeId, [AttributeIds.Value]))[0]
            method.outputArgs = decoded.value
        }
    }

    notify(nodeId: string, dataValue: DataValue) {
        if (!this._relatedNodeIds.has(nodeId)) return
        const dataItem = this._dataStore.get(nodeId)
        if (dataItem === undefined) return
        dataItem.updateValue(dataValue)
        const child = this.children.get(nodeId)
        if (child !== undefined) {
            child.value = normalizeValue(dataValue.value.value)
            child.statusCode = `${dataValue.statusCode.name ?? dataValue.statusCode.toString()}`
            child.valueName = this.enumLabelOf(child)
        }
    }

    private childOf(nodeId: string | null) {
        return nodeId === null ? null : (this.children.get(nodeId) ?? null)
    }

    private childByBrowseName(browseName: string): ProcessValueChild | null {
        for (const child of this.children.values()) {
            if (child.browseName === browseName) return child
        }
        return null
    }

    private childrenWithFeature(feature: string) {
        const out: ProcessValueChild[] = []
        for (const child of this.children.values()) {
            if (child.feature === feature) out.push(child)
        }
        return out
    }

    /* Decoded shape of one standardized enum Variable (Status / AlarmSuppression / DeviationSensitivity). */
    private enumChildJSON(child: ProcessValueChild | null) {
        if (child === null) return null
        return {
            NodeId: child.nodeId,
            BrowseName: child.browseName,
            DisplayName: child.displayName,
            SpecMatch: child.specMatch,
            Value: child.value,
            ValueName: child.valueName,
            StatusCode: child.statusCode,
            EnumValues: child.enumValues,
            SpecEnumValues: child.specEnumValues,
        }
    }

    toJSON() {
        const signal = this.childOf(this._analogSignalNodeId)
        const signalTag = this.childOf(this._signalTagNodeId)
        const setpoint = this.childOf(this._setpointNodeId)
        /* EURange / EngineeringUnits live as Properties of the AnalogSignal Variable. */
        const signalChildren = Array.from(this.children.values()).filter((child) => child.parentNodeId === this._analogSignalNodeId)
        const setpointChildren = Array.from(this.children.values()).filter((child) => child.parentNodeId === this._setpointNodeId)
        const setpointChildJSON = (browseName: string) => {
            const child = setpointChildren.find((candidate) => candidate.browseName === browseName) ?? null
            if (child === null) return null
            return { NodeId: child.nodeId, Value: child.value, StatusCode: child.statusCode, SpecMatch: child.specMatch }
        }
        const setpointJSON = setpoint === null ? null : {
            NodeId: setpoint.nodeId,
            BrowseName: setpoint.browseName,
            DisplayName: setpoint.displayName,
            SpecMatch: setpoint.specMatch,
            Value: setpoint.value,
            StatusCode: setpoint.statusCode,
            Deviation: Object.fromEntries(
                setpointChildren.filter((child) => child.feature === "processValues.deviation").map((child) => [child.browseName, child.value])
            ),
            DeviationSensitivity: this.enumChildJSON(setpointChildren.find((child) => child.browseName === "DeviationSensitivity") ?? null),
            SubstituteValue: setpointChildJSON("SubstituteValue"),
            AutoDeviationAdjustment: setpointChildJSON("AutoDeviationAdjustment"),
        }
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            References: Object.fromEntries(this.references.entries()),
            ActualValue: {
                Tag: signalTag ? { NodeId: signalTag.nodeId, Value: signalTag.value } : null,
                Value: signal ? { NodeId: signal.nodeId, Value: signal.value, StatusCode: signal.statusCode } : null,
                EURange: signalChildren.find((child) => child.browseName === "EURange")?.range ?? null,
                InstrumentRange: signalChildren.find((child) => child.browseName === "InstrumentRange")?.range ?? null,
                EngineeringUnits: signalChildren.find((child) => child.browseName === "EngineeringUnits")?.engineeringUnits ?? null,
            },
            Limits: Object.fromEntries(
                this.childrenWithFeature("processValues.limits").map((child) => [child.browseName, child.value])
            ),
            Status: this.enumChildJSON(this.childByBrowseName("Status")),
            AlarmSuppression: this.enumChildJSON(this.childByBrowseName("AlarmSuppression")),
            Setpoint: setpointJSON,
            Alarms: Array.from(this.alarms.values()).map((alarm) => {
                return {
                    NodeId: alarm.nodeId,
                    BrowseName: alarm.browseName,
                    DisplayName: alarm.displayName,
                    SpecEntry: alarm.specEntry,
                    SpecMatch: alarm.specMatch,
                    TypeDefinition: alarm.typeDefinition,
                    TypeDefinitionChain: alarm.typeDefinitionChain,
                    Children: alarm.children.map((child) => {
                        return {
                            NodeId: child.nodeId,
                            BrowseName: child.browseName,
                            DisplayName: child.displayName,
                            NodeClass: child.nodeClass,
                            Value: child.value,
                            StatusCode: child.statusCode,
                        }
                    }),
                }
            }),
            Methods: Array.from(this.methods.values()).map((method) => {
                return {
                    NodeId: method.nodeId,
                    BrowseName: method.browseName,
                    DisplayName: method.displayName,
                    SpecEntry: method.specEntry,
                    SpecMatch: method.specMatch,
                    InputArgs: method.inputArgs,
                    OutputArgs: method.outputArgs,
                    Note: method.note,
                }
            }),
            Children: Array.from(this.children.values()).map((child) => {
                return {
                    NodeId: child.nodeId,
                    BrowseName: child.browseName,
                    DisplayName: child.displayName,
                    Description: child.description,
                    NodeClass: child.nodeClass,
                    ParentNodeId: child.parentNodeId,
                    Reference: child.reference,
                    SpecEntry: child.specEntry,
                    SpecMatch: child.specMatch,
                    TypeDefinition: child.typeDefinition,
                    TypeDefinitionChain: child.typeDefinitionChain,
                    Feature: child.feature,
                    Value: child.value,
                    Range: child.range,
                    EngineeringUnits: child.engineeringUnits,
                    ValueName: child.valueName,
                    StatusCode: child.statusCode,
                }
            }),
            Features: Array.from(new Set(
                Array.from(this.children.values())
                    .filter((child) => child.specEntry !== null && child.specMatch)
                    .map((child) => child.feature)
                    .filter((feature) => feature !== null)
            )),
        }
    }
}
