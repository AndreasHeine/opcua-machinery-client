import {
    ClientSession,
    DataValue,
    AttributeIds,
} from "node-opcua";
import { UaTypeResolver } from "./ua-types";
import { browseComponents, browseProperties } from "./ua-browse";
import { DecodedValue, decodeEnumValues, decodeEUInformation, decodeRange, normalizeValue, readAttributes } from "./ua-read";
import { PROCESS_VALUE_TYPES } from "./ua-spec-processvalues";

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
 * One decoded child of a ProcessValueType instance.
 * `specEntry` says which entry of the OPC 40001-2 / OPC 30081 registry matched, which is what the
 * coverage report counts. `matchedTypeDefinition` records what the server actually uses, so foreign
 * or vendor specific children stay visible instead of being dropped.
 */
export type ProcessValueChild = {
    nodeId: string
    browseName: string | null
    displayName: string | null
    description: string | null
    /* registry entry the child matched (ua-spec-processvalues.ts) */
    feature: string | null
    /* decoded Value / EURange / EngineeringUnits / EnumValues of that child */
    value: any
    range: { low: number | null; high: number | null } | null
    engineeringUnits: { namespaceUri: string | null; unitId: number | null; displayName: string | null; displayUnit: string | null } | null
    enumValues: { value: number | null; valueName: string | null; displayName: string | null; description: string | null }[] | null
    statusCode: string
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
     * All discovered children of the instance, keyed by canonical NodeId
     */
    readonly children: Map<string, ProcessValueChild> = new Map()

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
        /* HasComponent children: AnalogSignal, limits, setpoint, Status, alarms, ... */
        const components = await browseComponents(this.session, this.nodeId)
        for (const child of components) {
            await this.loadChild(child.nodeId, child.browseName, child.displayName)
        }
        /* HasProperty children: SignalTag, and the AnalogUnit properties below the AnalogSignal */
        const properties = await browseProperties(this.session, this.nodeId)
        for (const child of properties) {
            await this.loadChild(child.nodeId, child.browseName, child.displayName)
        }
        if (this._analogSignalNodeId !== null) {
            const signalProperties = await browseProperties(this.session, this._analogSignalNodeId)
            for (const property of signalProperties) {
                await this.loadChild(property.nodeId, property.browseName, property.displayName, this._analogSignalNodeId)
            }
        }
    }

    /*
     * Read Value plus the AnalogUnit properties of one child in a single round trip and decode the
     * structures tolerantly (ua-read.ts). A child that cannot be read is still recorded, only with
     * its statusCode.
     */
    private async loadChild(nodeId: string, browseName: string | null, displayName: string | null, parentSignalNodeId?: string) {
        const attributeIds = [AttributeIds.Value, AttributeIds.Description]
        if (browseName === "EURange" || browseName === "InstrumentRange") attributeIds.push(AttributeIds.DataType)
        const readResults: DecodedValue[] = await readAttributes(this.session, nodeId, attributeIds)
        const value = readResults[0]
        const description = readResults[1]

        const child: ProcessValueChild = {
            nodeId,
            browseName,
            displayName,
            description: description.value,
            feature: null,
            value: value.value,
            range: null,
            engineeringUnits: null,
            enumValues: null,
            statusCode: value.statusCode,
        }
        this.children.set(nodeId, child)
        this._relatedNodeIds.add(nodeId)
        if (value.statusCodeIsUncertain || value.ok) {
            this._relatedVariableNodeIds.add(nodeId)
        }

        const dataItem = new dataStoreItem(nodeId, displayName, browseName, description.value)
        dataItem.updateValue(new DataValue({ statusCode: value.statusCode, value: { value: value.raw } } as any))
        this._dataStore.set(nodeId, dataItem)

        if (browseName === "AnalogSignal" && this._analogSignalNodeId === null) {
            this._analogSignalNodeId = nodeId
            child.feature = "processValues.analogSignal"
        } else if (browseName === "SignalTag") {
            if (this._signalTagNodeId === null) this._signalTagNodeId = nodeId
            child.feature = "processValues.signalTag"
        } else if (browseName === "EURange" || browseName === "InstrumentRange") {
            child.range = decodeRange(value.raw)
            child.feature = "processValues.ranges"
        } else if (browseName === "EngineeringUnits") {
            child.engineeringUnits = decodeEUInformation(value.raw)
            child.feature = "processValues.engineeringUnits"
        } else if (browseName === "LowLowLimit" || browseName === "LowLimit" || browseName === "HighLimit" || browseName === "HighHighLimit") {
            child.feature = "processValues.limits"
        } else if (browseName === "PercentageValue") {
            child.feature = "processValues.percentage"
        } else if (browseName === "Status" || browseName === "AlarmSuppression") {
            child.enumValues = decodeEnumValues(value.raw)
            child.feature = "processValues.status"
        } else if (browseName === "ProcessValueSetpoint") {
            child.feature = "processValues.setpoint"
        } else if (browseName === "ValuePrecision") {
            child.feature = "processValues.valuePrecision"
        }
    }

    notify(nodeId: string, dataValue: DataValue) {
        if (this._relatedNodeIds.has(nodeId)) {
            const dataItem = this._dataStore.get(nodeId)
            if (dataItem === undefined) return
            dataItem.updateValue(dataValue)
            const child = this.children.get(nodeId)
            if (child !== undefined) {
                child.value = normalizeValue(dataValue.value.value)
                child.statusCode = `${dataValue.statusCode.name ?? dataValue.statusCode.toString()}`
            }
        }
    }

    private childOf(nodeId: string | null) {
        return nodeId === null ? null : (this.children.get(nodeId) ?? null)
    }

    private childrenWithFeature(feature: string) {
        const out: ProcessValueChild[] = []
        for (const child of this.children.values()) {
            if (child.feature === feature) out.push(child)
        }
        return out
    }

    toJSON() {
        const signal = this.childOf(this._analogSignalNodeId)
        const signalTag = this.childOf(this._signalTagNodeId)
        /* EURange / EngineeringUnits live as Properties of the AnalogSignal Variable. */
        const signalChildren = Array.from(this.children.values()).filter((child) => child.nodeId !== this.nodeId)
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
                this.childrenWithFeature("processValues.limits").map((child) => [`${child.browseName}`, child.value])
            ),
            Features: Array.from(new Set(signalChildren.map((child) => child.feature).filter((feature) => feature !== null))),
        }
    }
}
