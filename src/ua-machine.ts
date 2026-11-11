import {
    AttributeIds,
    ClientSession,
    DataValue,
    ReferenceTypeIds,
} from "node-opcua";
import { UaBuildingBlock } from "./ua-building-block";
import { UaForeignMonitoringType } from "./ua-foreign-monitoring";
import { UaMachineryComponent } from "./ua-machine-component";
import { UaProcessValue } from "./ua-processvalue";
import { TypeMatch, UaTypeResolver } from "./ua-types";
import { browseAddIns, browseChildByBrowseName, browseComponents, browseOrganized, isMethodNode, UaRef } from "./ua-browse";
import { normalizeValue, readAttributes } from "./ua-read";
import {
    ALL_BLOCK_TYPE_REFS,
    BUILDING_BLOCKS,
    BUILDING_BLOCKS_FOLDER_BROWSE_NAME,
    CORE_TYPES,
    NAMESPACES,
    findBuildingBlockByBrowseName,
    findBuildingBlockByTypeRef,
} from "./ua-spec";
import { PROCESS_VALUE_INSTANCE_NAME_PREFIX, PROCESS_VALUE_TYPES } from "./ua-spec-processvalues";
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
 * Every candidate child is classified through the TypeDefinition + HasSubtype chain (see ua-types.ts),
 * so vendor subtypes such as 'ExtrusionMachineryItemState_StateMachineType' are recognized. A child
 * that carries a spec block BrowseName (or a documented vendor alias such as 'Equipment') but a foreign
 * chain is still loaded and reported - as a deviation, not as spec coverage.
 */

/* 40001-1 §16.2 Table 41 - the declared Monitoring subfolders are descended into when looking for
   ProcessValueType instances; everything else below a Monitoring block is reported as foreign. */
const MONITORING_SUBFOLDER_NAMES: string[] = (
    BUILDING_BLOCKS.find((block) => block.key === "monitoring") ?? { members: [] }
).members.map((member) => member.browseName)

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
     * OPC 40001-1 §6.3.1 - every building block candidate found for this machine,
     * keyed by canonical block NodeId (matched and foreign candidates alike).
     */
    readonly blocks: Map<string, UaBuildingBlock> = new Map()

    /**
     * OPC 40001-2 / §16 - monitoring content below a Monitoring block (or named like a process value)
     * whose TypeDefinition chain does not reach the spec ProcessValueType [ns=Machinery/ProcessValues].
     * Reported, never modelled, never subscribed.
     */
    readonly foreignMonitoring: Map<string, UaForeignMonitoringType> = new Map()

    /**
     * Block candidate refs kept from discoverBuildingBlocks() for reuse by discoverMonitoringContent().
     */
    private _blockCandidateRefs: UaRef[] = []

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
        for (const block of this.blocks.values()) {
            block.notify(nodeId, dataValue)
        }
        for (const processValue of this.monitoring.values()) {
            processValue.notify(nodeId, dataValue)
        }
        for (const component of this.components.values()) {
            component.notify(nodeId, dataValue)
        }
    }

    async discoverMetaData() {
        await this.loadMachineComponents()
        await this.discoverBuildingBlocks()
        await this.discoverMonitoringContent()
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

    /* Blocks and AddIns may be referenced from the item itself or from the MachineryBuildingBlocks folder. */
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
        const isFolderLike = chain.some((entry) => entry.browseName === CORE_TYPES.folderType.browseName) || chain.length === 0
        if (!isFolderLike) {
            log.debug(`OPC UA Client: Machine '${this.nodeId}' child '${candidate.nodeId}' is named '${BUILDING_BLOCKS_FOLDER_BROWSE_NAME}' but is not FolderType based!`)
        }
        return candidate
    }

    /*
     * §16 + OPC 40001-2 - monitoring content: everything below the machine's Monitoring blocks
     * (matched or foreign candidates), plus vendor process-value lookalikes that sit directly on the
     * item or in the MachineryBuildingBlocks folder. Chain-matched ProcessValueType instances are
     * modelled by UaProcessValue; everything else becomes a ForeignMonitoringType entry with its
     * TypeDefinition chain and the Values of its direct Variable children.
     */
    async discoverMonitoringContent() {
        const processValueRefs = new Map<string, UaRef>()
        const seen = new Set<string>()
        for (const block of this.blocks.values()) {
            if (block.spec.key !== "monitoring") continue
            this._relatedNodeIds.add(block.ref.nodeId)
            await this.scanMonitoringSubtree(
                block.ref.nodeId,
                `Monitoring block '${block.ref.browseName}' [${block.ref.nodeId}]`,
                processValueRefs,
                seen,
                0,
            )
        }
        /*
         * Vendor process-value lookalikes without any Monitoring block (demo: 'ProcessValue_1' /
         * 'ProcessValue_2' on ns=33;i=5044 in a foreign namespace): the spec DefaultInstanceBrowseName
         * prefix marks them as monitoring candidates that must be classified, not silently skipped.
         */
        for (const ref of [...this._addIns, ...this._components, ...this._blockCandidateRefs]) {
            if (seen.has(ref.nodeId) || !ref.browseName.startsWith(PROCESS_VALUE_INSTANCE_NAME_PREFIX)) continue
            seen.add(ref.nodeId)
            const match = await this.resolver.match(ref.nodeId, [PROCESS_VALUE_TYPES.processValueType])
            if (match.ref !== undefined) {
                processValueRefs.set(ref.nodeId, ref)
            } else {
                await this.reportForeignMonitoring(
                    ref,
                    match,
                    `direct child of machine '${this.nodeId}'`,
                    `BrowseName looks like a '${PROCESS_VALUE_INSTANCE_NAME_PREFIX}...' instance but the TypeDefinition chain does not reach the 40001-2 ProcessValueType of namespace '${NAMESPACES.processValues}'`,
                )
            }
        }
        for (const nodeId of processValueRefs.keys()) {
            await this.loadProcessValue(nodeId)
        }
    }

    /*
     * Collect candidates below a Monitoring block. Only §16.2 Table 41 subfolder names (Status /
     * Health / Process / Consumption) and plain FolderType objects are descended; vendor-typed Objects
     * (ChannelMonitoringType, Stacklight, MachineTool, ...) are reported as foreign entries including
     * their direct Variable values. Bounded at depth 2 below the block.
     */
    private async scanMonitoringSubtree(nodeId: string, foundUnder: string, processValueRefs: Map<string, UaRef>, seen: Set<string>, depth: number) {
        if (depth > 2) return
        const children = [
            ...await browseComponents(this.session, nodeId),
            ...await browseOrganized(this.session, nodeId),
        ]
        for (const child of children) {
            if (seen.has(child.nodeId)) continue
            seen.add(child.nodeId)
            if (isMethodNode(child.nodeClass)) continue
            const match = await this.resolver.match(child.nodeId, [PROCESS_VALUE_TYPES.processValueType])
            if (match.ref !== undefined) {
                processValueRefs.set(child.nodeId, child)
                continue
            }
            const isDeclaredSubfolder = MONITORING_SUBFOLDER_NAMES.includes(child.browseName)
            const isFolderLike = match.chain.some((entry) => entry.browseName === CORE_TYPES.folderType.browseName)
            if (depth < 2 && (isDeclaredSubfolder || isFolderLike)) {
                await this.scanMonitoringSubtree(child.nodeId, `${foundUnder} -> '${child.browseName}' [${child.nodeId}]`, processValueRefs, seen, depth + 1)
                continue
            }
            await this.reportForeignMonitoring(child, match, foundUnder, "child of a Monitoring block but the TypeDefinition chain is not a ProcessValueType")
        }
    }

    private async reportForeignMonitoring(ref: UaRef, match: TypeMatch, foundUnder: string, reason: string) {
        const entry = new UaForeignMonitoringType(this.session, this.resolver, ref, match, foundUnder, reason)
        await entry.initialize()
        this.foreignMonitoring.set(ref.nodeId, entry)
        entry._relatedNodeIds.forEach((nodeId) => this._relatedNodeIds.add(nodeId))
        log.debug(`OPC UA Client: machine '${this.nodeId}' foreign monitoring '${ref.nodeId}' TypeDefinition='${match.typeDefinition?.browseName ?? "?"}' (${reason})`)
    }

    /*
     * A chain-matched ProcessValueType candidate. UaProcessValue.classifyInstance() throws when the chain
     * does not reach the spec ProcessValueType - that throw is the filter contract, warn and keep going.
     */
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

    /*
     * §6.3.1 / §8 / §12 - §18 - generic building block discovery.
     * Every candidate child (HasAddIn / HasComponent of the item or of the MachineryBuildingBlocks
     * folder) is classified against ALL_BLOCK_TYPE_REFS through its HasSubtype chain. Matched children
     * are modelled as spec blocks; children that only carry a spec block BrowseName (or vendor alias)
     * are loaded as foreign candidates so the deviation shows up in output.json.
     */
    async discoverBuildingBlocks() {
        const blocksFolder = await this.findBuildingBlocksFolder()
        const folderRefs: UaRef[] = blocksFolder === null
            ? []
            : [...await browseAddIns(this.session, blocksFolder.nodeId), ...await browseComponents(this.session, blocksFolder.nodeId)]
        /*
         * A block can be reached in several ways at once: as HasAddIn of the MachineryBuildingBlocks
         * folder, as HasComponent of that folder (the umati demo server exposes both, so the same block
         * NodeId comes back twice), or directly from the MachineryItem. Keyed by canonical NodeId, so
         * every block is loaded exactly once.
         */
        const candidateRefsById = new Map<string, UaRef>()
        for (const ref of [...folderRefs, ...this._addIns, ...this._components]) {
            if (ref.browseName === BUILDING_BLOCKS_FOLDER_BROWSE_NAME) continue
            /* read-only client: Methods (SetMachineTime, ...) are never modelled, browsed or called */
            if (isMethodNode(ref.nodeClass)) continue
            if (!candidateRefsById.has(ref.nodeId)) candidateRefsById.set(ref.nodeId, ref)
        }
        this._blockCandidateRefs = Array.from(candidateRefsById.values())
        for (const ref of candidateRefsById.values()) {
            const match = await this.resolver.match(ref.nodeId, ALL_BLOCK_TYPE_REFS)
            const spec = match.ref !== undefined
                ? findBuildingBlockByTypeRef(match.ref)
                : findBuildingBlockByBrowseName(ref.browseName)
            if (spec === undefined) {
                log.debug(`OPC UA Client: machine '${this.nodeId}' child '${ref.nodeId}' TypeDefinition='${match.typeDefinition?.browseName ?? "?"}' is not an OPC 40001-1 building block, skipped`)
                continue
            }
            const block = new UaBuildingBlock(this.session, this.resolver, spec, ref, match)
            await block.initialize()
            this.blocks.set(ref.nodeId, block)
            this._relatedNodeIds.add(ref.nodeId)
            block._relatedNodeIds.forEach((nodeId) => this._relatedNodeIds.add(nodeId))
            block._relatedVariableNodeIds.forEach((nodeId) => this._relatedVariableNodeIds.add(nodeId))
        }
        this.wireBuildingBlocks()
    }

    /*
     * Feed the legacy top-level fields from the block models (these keys stay in output.json until the
     * Phase 6 output reshape): Identification properties, MachineryItemState and MachineryOperationMode.
     * A matched state-machine block wins over a foreign candidate of the same name.
     */
    private wireBuildingBlocks() {
        let itemStateBlock: UaBuildingBlock | null = null
        let operationModeBlock: UaBuildingBlock | null = null
        for (const block of this.blocks.values()) {
            if (block.spec.key === "identification") {
                block.members.forEach((value, key) => this.identification.set(key, value))
                block.memberKeyByNodeId.forEach((key, nodeId) => this._identificationKeyByNodeId.set(nodeId, key))
            }
            if (block.spec.key === "itemState" && block.currentStateNodeId !== null) {
                if (itemStateBlock === null || (block.matched && !itemStateBlock.matched)) itemStateBlock = block
            }
            if (block.spec.key === "operationMode" && block.currentStateNodeId !== null) {
                if (operationModeBlock === null || (block.matched && !operationModeBlock.matched)) operationModeBlock = block
            }
        }
        if (itemStateBlock !== null) {
            this.itemState = itemStateBlock.currentState
            this.itemStateNodeId = itemStateBlock.currentStateNodeId
        }
        if (operationModeBlock !== null) {
            this.operationMode = operationModeBlock.currentState
            this.operationModeNodeId = operationModeBlock.currentStateNodeId
        }
    }

    /* Count of modelled blocks per spec key, foreign candidates under 'foreign:<key>'. */
    buildingBlockCounts(): Map<string, number> {
        const counts = new Map<string, number>()
        for (const block of this.blocks.values()) {
            const key = block.matched ? block.spec.key : `foreign:${block.spec.key}`
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        return counts
    }

    toJSON() {
        const blocksBySpecKey: Record<string, any[]> = {}
        const foreignBlocks: any[] = []
        for (const block of this.blocks.values()) {
            if (block.matched) {
                const bucket = blocksBySpecKey[block.spec.key] ?? []
                bucket.push(block.toJSON())
                blocksBySpecKey[block.spec.key] = bucket
            } else {
                foreignBlocks.push(block.toJSON())
            }
        }
        blocksBySpecKey["Foreign"] = foreignBlocks
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            References: Object.fromEntries(this.references.entries()),
            Identification: Object.fromEntries(this.identification.entries()),
            Components: Array.from(this.components.values()).map((c) => { return c.toJSON() }),
            MachineryItemState: this.itemState,
            MachineryOperationMode: this.operationMode,
            Monitoring: Array.from(this.monitoring.values()).map((c) => { return c.toJSON() }),
            ForeignMonitoringTypes: Array.from(this.foreignMonitoring.values()).map((f) => { return f.toJSON() }),
            BuildingBlocks: blocksBySpecKey,
        }
    }
}
