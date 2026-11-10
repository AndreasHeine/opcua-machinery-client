import {
    AttributeIds,
    ClientSession,
    DataValue,
} from "node-opcua"
import { UaTypeResolver } from "./ua-types"
import { browseAddIns, browseComponents, browseProperties, UaRef } from "./ua-browse"
import { normalizeValue, readAttributes } from "./ua-read"

/*
 * OPC 40001-1 §10 / §11 - a MachineryComponent below the Components AddIn.
 *
 * A component carries its own Identification AddIn (§10.2) and may itself expose a Components AddIn,
 * so nested components are modelled recursively (bounded by maxDepth) instead of only one level deep.
 */
export class UaMachineryComponent {

    private session: ClientSession
    private resolver: UaTypeResolver
    private maxDepth: number
    readonly nodeId: string

    /**
     * Attributes of the MachineComponent-Instance-Object e.g. DisplayName, BrowseName and Description
     */
    readonly attributes: Map<string, any> = new Map()

    /**
     * Additional References of the MachineComponent-Instance-Object e.g. TypeDefinition
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
     * Nested components when the component itself has a Components AddIn
     */
    readonly components: Map<string, UaMachineryComponent> = new Map()

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
     * HasComponent References
     */
    _components: UaRef[] = []

    /**
     * HasAddIn References
     */
    _addIns: UaRef[] = []

    constructor(session: ClientSession, nodeId: string, resolver: UaTypeResolver, maxDepth: number = 2) {
        this.session = session
        this.nodeId = nodeId
        this.resolver = resolver
        this.maxDepth = maxDepth
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
        await this.loadMachineComponentTypeDefinition()
        this._addIns = await browseAddIns(this.session, this.nodeId)
        this._components = await browseComponents(this.session, this.nodeId)
        this._addIns.forEach((addIn) => this._relatedNodeIds.add(addIn.nodeId))
        this._components.forEach((component) => this._relatedNodeIds.add(component.nodeId))
        await this.discoverMetaData()
        this._lastInitialization = new Date()
    }

    /* TypeDefinition + HasSubtype chain, reported for the coverage view. */
    async loadMachineComponentTypeDefinition() {
        const typeDefinitionNodeId = await this.resolver.typeDefinitionOf(this.nodeId)
        if (typeDefinitionNodeId === null) {
            console.warn(`MachineComponent-Instance '${this.nodeId}' has no TypeDefinition-Reference!`)
            return
        }
        this._relatedNodeIds.add(typeDefinitionNodeId)
        const chain = await this.resolver.chainOf(typeDefinitionNodeId)
        const typeDefinition = chain[0] ?? null
        this.references.set("TypeDefinition", typeDefinition?.browseName ?? typeDefinition?.displayName ?? null)
        this.references.set("TypeDefinitionChain", UaTypeResolver.formatChain(chain))
    }

    async discoverMetaData() {
        await this.loadMachineComponentIdentification()
        await this.loadNestedComponents()
    }

    /* §10.2 - Identification AddIn: read every HasProperty of it in one round trip per Property. */
    async loadMachineComponentIdentification() {
        for (const addIn of this._addIns) {
            if (addIn.browseName !== "Identification") continue
            const properties = await browseProperties(this.session, addIn.nodeId)
            if (properties.length === 0) continue
            for (const property of properties) {
                this._relatedNodeIds.add(property.nodeId)
                const decoded = await readAttributes(this.session, property.nodeId, [AttributeIds.Value, AttributeIds.DisplayName])
                if (!decoded[0].ok) continue
                const key = `${decoded[1].value ?? property.browseName}`
                this.identification.set(key, decoded[0].value)
                this._identificationKeyByNodeId.set(property.nodeId, key)
                this._relatedVariableNodeIds.add(property.nodeId)
            }
        }
    }

    /* §11 - a component may carry its own Components AddIn. */
    private async loadNestedComponents() {
        if (this.maxDepth <= 0) return
        const componentsAddIn = this._addIns.find((addIn) => addIn.browseName === "Components")
            ?? this._components.find((component) => component.browseName === "Components")
        if (componentsAddIn === undefined) return
        const nestedRefs = await browseComponents(this.session, componentsAddIn.nodeId)
        for (const nestedRef of nestedRefs) {
            if (nestedRef.nodeId === this.nodeId) continue
            const nested = new UaMachineryComponent(this.session, nestedRef.nodeId, this.resolver, this.maxDepth - 1)
            await nested.initialize()
            this.components.set(nestedRef.nodeId, nested)
            this._relatedNodeIds.add(nestedRef.nodeId)
        }
    }

    notify(nodeId: string, dataValue: DataValue) {
        const key = this._identificationKeyByNodeId.get(nodeId)
        if (key === undefined) return
        const value = normalizeValue(dataValue.value.value)
        if (this.identification.get(key) === value) return
        console.log(`OPC UA Client: DataChange component nodeId='${nodeId}' identification='${key}' value='${JSON.stringify(value)}'`)
        this.identification.set(key, value)
        for (const component of this.components.values()) {
            component.notify(nodeId, dataValue)
        }
    }

    toJSON(): any {
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            References: Object.fromEntries(this.references.entries()),
            Identification: Object.fromEntries(this.identification.entries()),
            Components: Array.from(this.components.values()).map((component) => component.toJSON()),
        }
    }
}
