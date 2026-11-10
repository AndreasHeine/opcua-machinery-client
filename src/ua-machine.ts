import {
    AttributeIds,
    ClientSession,
    DataValue,
    DataTypeIds,
    ReferenceTypeIds,
} from "node-opcua";
import { UaMachineryComponent } from "./ua-machine-component";
import { UaProcessValue } from "./ua-processvalue";
import { UaTypeResolver } from "./ua-types";
import { browseAddIns, browseChildByBrowseName, browseComponents, browseOrganized, browseProperties, UaRef } from "./ua-browse";
import { normalizeValue, readAttributes, readAttributeOfMany, readValue } from "./ua-read";
import { BUILDING_BLOCKS_FOLDER_BROWSE_NAME, MACHINERY_TYPES, NAMESPACES } from "./ua-spec";
import { PROCESS_VALUE_TYPES } from "./ua-spec-processvalues";
import { log } from "./config";

/*
 * OPC 40001-1 MachineryItem (the Object discovered under the Machines folder).
 *
 * Discovery follows the spec structure:
 *   MachineryItem
 *     +- Identification            (AddIn,  40001-1 §8)   - also allowed directly on the item
 *     +- Components                (AddIn,  40001-1 §11)  - also allowed directly on the item
 *     +- MachineryBuildingBlocks   (Object, 40001-1 §6.3.1 BrowseName "MachineryBuildingBlocks")
 *          +- MachineryItemState        (AddIn, §12)
 *          +- MachineryOperationMode    (AddIn, §13)
 *          +- OperationCounters         (AddIn, §14)
 *          +- LifetimeCounters          (AddIn, §15)
 *          +- Monitoring                (AddIn, §16)
 *          +- MachineryEquipment        (AddIn, §17)
 *          +- Notifications             (AddIn, §18)
 *
 * Classification is done through the TypeDefinition + HasSubtype chain (see ua-types.ts), so vendor
 * subtypes such as 'ExtrusionMachineryItemState_StateMachineType' are recognized instead of skipped.
 */

export class UaMachineryMachine {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly nodeId: string
    readonly namespaceArray: string[] = []

    /**
     * Attributes of the Machine-Instance-Object e.g. DisplayName, BrowseName and Description
     */
    readonly attributes: Map<string, any> = new Map()

    /**
     * Additional References of the Machine-Instance-Object e.g. TypeDefinition
     */
    readonly references: Map<string, any> = new Map()

    /**
     * A Map of all the found Identification-Properties
     */
    readonly identification: Map<string, any> = new Map()

    /**
     * Identification map key per Property NodeId, used by notify()
     */
    private _identificationKeyByNodeId: Map<string, string> = new Map()

    /**
     * A Map of all the found MachineryComponents
     */
    readonly components: Map<string, UaMachineryComponent> = new Map()

    /**
     * A Map of all the found MachineryProcessValues
     */
    readonly monitoring: Map<string, UaProcessValue> = new Map()

    /**
     * Value of CurrentState-Variable of the MachineryItemState_StateMachine
     */
    itemState: string | null = null

    itemStateNodeId: string | null = null

    /**
     * Value of CurrentState-Variable of the MachineryOperationMode_StateMachine
     */
    operationMode: string | null = null

    operationModeNodeId: string | null = null

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
     * HasComponent references of the machine instance
     */
    _components: UaRef[] = []

    /**
     * HasAddIn references of the machine instance
     */
    _addIns: UaRef[] = []

    /*
     * A CurrentState Variable may hold an empty LocalizedText ({locale:null,text:null}); that must stay
     * null in output.json instead of becoming the string "null".
     */
    private static stateTextOf(value: any): string | null {
        return value === null || value === undefined ? null : `${value}`
    }

    constructor(session: ClientSession, nodeId: string, namespaceArray: string[], resolver: UaTypeResolver) {
        this.session = session
        this.nodeId = nodeId
        this.namespaceArray = namespaceArray
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
        await this.loadMachineTypeDefinition()
        this._addIns = await browseAddIns(this.session, this.nodeId)
        this._components = await browseComponents(this.session, this.nodeId)
        this._addIns.forEach((reference) => this._relatedNodeIds.add(reference.nodeId))
        this._components.forEach((reference) => this._relatedNodeIds.add(reference.nodeId))
        await this.discoverMetaData()
        this._lastInitialization = new Date()
    }

    /*
     * Fan-out from the single subscription's `changed` handler.
     * Each model decides for itself whether the NodeId belongs to it, so a wrong machine costs a Set
     * lookup instead of a wrong value.
     */
    notify(nodeId: string, dataValue: DataValue) {
        const value = normalizeValue(dataValue.value.value)
        if (nodeId === this.itemStateNodeId) {
            this.itemState = UaMachineryMachine.stateTextOf(value)
        }
        if (nodeId === this.operationModeNodeId) {
            this.operationMode = UaMachineryMachine.stateTextOf(value)
        }
        const identificationKey = this._identificationKeyByNodeId.get(nodeId)
        if (identificationKey !== undefined) {
            this.identification.set(identificationKey, value)
        }
        for (const processValue of this.monitoring.values()) {
            processValue.notify(nodeId, dataValue)
        }
        for (const component of this.components.values()) {
            component.notify(nodeId, dataValue)
        }
    }

    async discoverMetaData() {
        await this.loadMachineIdentification()
        await this.loadMachineComponents()
        await this.loadMonitoring()
        await this.loadBuildingBlocks()
    }

    /*
     * HasTypeDefinition + HasSubtype chain of this instance.
     * The chain is what every later classification decision is based on.
     */
    async loadMachineTypeDefinition() {
        const typeDefinitionNodeId = await this.resolver.typeDefinitionOf(this.nodeId)
        if (typeDefinitionNodeId === null) {
            log.warn(`Machine-Instance '${this.nodeId}' has no TypeDefinition-Reference!`)
            return
        }
        this._relatedNodeIds.add(typeDefinitionNodeId)
        const chain = await this.resolver.chainOf(typeDefinitionNodeId)
        const typeDefinition = chain[0] ?? null
        this.references.set("TypeDefinition", typeDefinition?.browseName ?? typeDefinition?.displayName ?? null)
        this.references.set("TypeDefinitionNodeId", typeDefinitionNodeId)
        this.references.set("TypeDefinitionChain", UaTypeResolver.formatChain(chain))
        log.info(`OPC UA Client: Machine '${this.nodeId}' type chain: ${UaTypeResolver.formatChain(chain)}`)
    }

    /* §8 - Identification AddIn (also allowed directly on the MachineryItem). */
    async loadMachineIdentification() {
        for (const addIn of this._addIns) {
            if (addIn.browseName !== "Identification") continue
            await this.loadIdentificationOf(addIn)
        }
    }

    /* Reads all HasProperty children of an Identification instance. */
    async loadIdentificationOf(identification: UaRef) {
        this._relatedNodeIds.add(identification.nodeId)
        const properties = await browseProperties(this.session, identification.nodeId)
        if (properties.length === 0) return
        const readResults = await readAttributeOfMany(this.session, properties.map((property) => property.nodeId))
        for (let index = 0; index < properties.length; index++) {
            const property = properties[index]
            const decoded = readResults[index]
            this._relatedNodeIds.add(property.nodeId)
            if (!decoded.ok) continue
            const key = `${property.displayName ?? property.browseName}`
            this.identification.set(key, decoded.value)
            this._identificationKeyByNodeId.set(property.nodeId, key)
            this._relatedVariableNodeIds.add(property.nodeId)
        }
    }

    /* §11 - Components AddIn: every HasComponent child of the Components instance is a component. */
    async loadMachineComponents() {
        const componentsAddIn = await this.findAddInOrComponent("Components")
        if (componentsAddIn === null) return
        const componentRefs = await browseComponents(this.session, componentsAddIn.nodeId)
        for (const componentRef of componentRefs) {
            const component = new UaMachineryComponent(this.session, componentRef.nodeId, this.resolver)
            await component.initialize()
            /* canonical NodeId string - a raw ExpandedNodeId would stringify with a namespaceUri and
               never match the canonical keys used everywhere else in this client */
            this.components.set(componentRef.nodeId, component)
            this._relatedNodeIds.add(componentRef.nodeId)
        }
    }

    /* Blocks may be referenced from the MachineryBuildingBlocks folder or from the item itself. */
    private async findAddInOrComponent(browseName: string): Promise<UaRef | null> {
        const direct = this._addIns.find((addIn) => addIn.browseName === browseName)
        if (direct !== undefined) return direct
        const viaComponent = this._components.find((component) => component.browseName === browseName)
        if (viaComponent !== undefined) return viaComponent
        const blocksFolder = await this.findBuildingBlocksFolder()
        if (blocksFolder === null) return null
        return await browseChildByBrowseName(this.session, blocksFolder.nodeId, browseName, ReferenceTypeIds.HasAddIn)
            ?? await browseChildByBrowseName(this.session, blocksFolder.nodeId, browseName, ReferenceTypeIds.HasComponent)
    }

    /* §6.3.1 - Object of FolderType (or subtype) with BrowseName 'MachineryBuildingBlocks'. */
    private async findBuildingBlocksFolder(): Promise<UaRef | null> {
        const candidate = this._components.find((component) => component.browseName === BUILDING_BLOCKS_FOLDER_BROWSE_NAME)
        if (candidate === undefined) return null
        const chain = await this.resolver.chainOfNode(candidate.nodeId)
        const isFolderLike = chain.some((entry) => entry.browseName === "FolderType") || chain.length === 0
        if (!isFolderLike) {
            log.debug(`OPC UA Client: Machine '${this.nodeId}' child '${candidate.nodeId}' is named '${BUILDING_BLOCKS_FOLDER_BROWSE_NAME}' but is not FolderType based!`)
        }
        return candidate
    }

    async loadProcessValue(id: string) {
        try {
            const processValue = new UaProcessValue(this.session, id, this.resolver)
            await processValue.initialize()
            this.monitoring.set(id, processValue)
            this._relatedNodeIds.add(id)
        } catch (error) {
            log.warn(`OPC UA Client: error while loading ProcessValue -> ${(error as Error).message}`)
        }
    }

    /* §16 - Monitoring building block: ProcessValueType instances plus foreign monitoring types. */
    async loadMonitoring() {
        const monitoringBlock = await this.findAddInOrComponent("Monitoring")
        if (monitoringBlock === null) return
        this._relatedNodeIds.add(monitoringBlock.nodeId)
        if (this.resolver.namespaceIndexOf(NAMESPACES.processValues) === undefined) {
            log.debug(`OPC UA Client: server has no '${NAMESPACES.processValues}' namespace, skipping Monitoring content of '${this.nodeId}'`)
            return
        }
        const children = [
            ...(await browseComponents(this.session, monitoringBlock.nodeId)),
            ...(await browseOrganized(this.session, monitoringBlock.nodeId)),
        ]
        for (const child of children) {
            const match = await this.resolver.match(child.nodeId, [PROCESS_VALUE_TYPES.processValueType])
            if (match.ref === undefined) {
                log.debug(`OPC UA Client: Monitoring child '${child.nodeId}' TypeDefinition='${match.typeDefinition?.browseName ?? "?"}' is not a ProcessValueType, reported as foreign type`)
                continue
            }
            await this.loadProcessValue(child.nodeId)
        }
    }

    /*
     * §12 / §13 - MachineryItemState and MachineryOperationMode CurrentState.
     * Matched through the HasSubtype chain of the state machine TypeDefinition, so vendor subtypes
     * are handled without a hardcoded name list.
     */
    async loadBuildingBlocks() {
        /*
         * A block can be reached in several ways at once: as HasAddIn of the MachineryBuildingBlocks
         * folder, as HasComponent of that folder (the umati demo server exposes both, so the same block
         * NodeId comes back twice), or directly from the MachineryItem. Keyed by canonical NodeId, so
         * every block is loaded exactly once.
         */
        const blocksFolder = await this.findBuildingBlocksFolder()
        const folderRefs: UaRef[] = blocksFolder === null
            ? []
            : [...await browseAddIns(this.session, blocksFolder.nodeId), ...await browseComponents(this.session, blocksFolder.nodeId)]
        const blockRefsById = new Map<string, UaRef>()
        for (const ref of [...folderRefs, ...this._addIns, ...this._components]) {
            if (!blockRefsById.has(ref.nodeId)) blockRefsById.set(ref.nodeId, ref)
        }
        for (const blockRef of blockRefsById.values()) {
            const match = await this.resolver.match(blockRef.nodeId, [
                MACHINERY_TYPES.machineryItemStateStateMachineType,
                MACHINERY_TYPES.machineryOperationModeStateMachineType,
            ])
            if (match.ref === undefined) continue
            this._relatedNodeIds.add(blockRef.nodeId)
            const stateVariables = await browseComponents(this.session, blockRef.nodeId)
            for (const stateVariable of stateVariables) {
                if (stateVariable.browseName !== "CurrentState") continue
                this._relatedNodeIds.add(stateVariable.nodeId)
                const decoded = await readValue(this.session, stateVariable.nodeId)
                if (decoded.ok || decoded.statusCodeIsUncertain) {
                    this._relatedVariableNodeIds.add(stateVariable.nodeId)
                }
                const stateText = (decoded.ok || decoded.statusCodeIsUncertain)
                    ? UaMachineryMachine.stateTextOf(decoded.value)
                    : null
                if (match.ref === MACHINERY_TYPES.machineryItemStateStateMachineType) {
                    this.itemState = stateText
                    this.itemStateNodeId = stateVariable.nodeId
                } else {
                    this.operationMode = stateText
                    this.operationModeNodeId = stateVariable.nodeId
                }
            }
        }
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            References: Object.fromEntries(this.references.entries()),
            Identification: Object.fromEntries(this.identification.entries()),
            Components: Array.from(this.components.values()).map((c) => { return c.toJSON() }),
            MachineryItemState: this.itemState,
            MachineryOperationMode: this.operationMode,
            Monitoring: Array.from(this.monitoring.values()).map((c) => { return c.toJSON() })
        }
    }
}
