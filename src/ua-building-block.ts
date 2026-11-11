import {
    ClientSession,
    DataValue,
    NodeClass,
} from "node-opcua";
import { isObjectNode, isVariableNode, UaRef, browseComponents, browseProperties } from "./ua-browse";
import { TypeMatch, UaTypeResolver } from "./ua-types";
import { normalizeValue, readAttributeOfMany } from "./ua-read";
import { CORE_TYPES, STATE_TABLES, SpecMember, BuildingBlockSpec } from "./ua-spec";
import { log } from "./config";

/*
 * OPC 40001-1 §6.3.1 - one building block instance of a MachineryItem.
 *
 * The same generic model covers all nine blocks (§8 / §12 / §13 / §14 / §15 / §16 / §17 / §18): the
 * block TypeDefinition (from ua-spec.ts) declares which members are expected, the instance is browsed
 * once and every direct Variable/Property child is read in one batch.
 *
 * A block is 'matched' when the TypeDefinition + HasSubtype chain reaches one of the block's spec
 * TypeRefs. A candidate that has the spec BrowseName but a foreign chain (e.g. the umati demo's plain
 * FolderType 'Equipment' folder) is still loaded and reported - it is a deviation worth showing, but
 * it is grouped under 'Foreign' in output.json and never claimed as spec coverage.
 *
 * Read-only implementation: Members with access 'RW' in the spec (AssetId, MachineryEquipmentTypeId,
 * ComponentName, ...) are only read and monitored, never written.
 */

export type BlockChild = {
    ref: UaRef
    /* 'state' / 'transition' for §12/§13 instance states, 'child' for everything else */
    kind: "state" | "transition" | "child"
    typeDefinitionNodeId: string | null
    typeDefinition: string | null
    typeDefinitionChain: string
    /* 0:StateNumber value, when the §12/§13 state Object is present on the instance */
    stateNumber: number | null
    /* §17 - Properties of a MachineryEquipment child, read one level down */
    members: Map<string, any>
    memberKeyByNodeId: Map<string, string>
    _relatedVariableNodeIds: Set<string>
}

export class UaBuildingBlock {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly spec: BuildingBlockSpec
    readonly ref: UaRef
    readonly match: TypeMatch

    /**
     * CurrentState of a §12 / §13 state machine instance (inherited from 0:StateMachineType).
     */
    currentState: string | null = null

    currentStateNodeId: string | null = null

    /**
     * Values of the direct Variable/Property children of the block, keyed by BrowseName.
     */
    readonly members: Map<string, any> = new Map()

    /**
     * Member map key per Variable/Property NodeId, used by notify().
     */
    readonly memberKeyByNodeId: Map<string, string> = new Map()

    /**
     * Direct Object children of the block (states, equipment, monitoring subfolders, ...).
     */
    readonly children: Map<string, BlockChild> = new Map()

    _relatedNodeIds = new Set<string>()

    _relatedVariableNodeIds = new Set<string>()

    _lastInitialization = new Date()

    constructor(session: ClientSession, resolver: UaTypeResolver, spec: BuildingBlockSpec, ref: UaRef, match: TypeMatch) {
        this.session = session
        this.resolver = resolver
        this.spec = spec
        this.ref = ref
        this.match = match
        this._relatedNodeIds.add(ref.nodeId)
    }

    /* true when the TypeDefinition chain reaches one of the block's spec TypeRefs. */
    get matched(): boolean {
        return this.match.ref !== undefined
    }

    get matchedBrowseName(): string | null {
        return this.match.ref?.browseName ?? null
    }

    private static stateTextOf(value: any): string | null {
        return value === null || value === undefined ? null : `${value}`
    }

    async initialize() {
        const components = await browseComponents(this.session, this.ref.nodeId)
        const properties = await browseProperties(this.session, this.ref.nodeId)
        const childrenById = new Map<string, UaRef>()
        for (const child of [...components, ...properties]) {
            if (!childrenById.has(child.nodeId)) childrenById.set(child.nodeId, child)
        }
        const variableRefs = Array.from(childrenById.values()).filter((child) => isVariableNode(child.nodeClass))
        const objectRefs = Array.from(childrenById.values()).filter((child) => isObjectNode(child.nodeClass))

        /* every direct Variable/Property child is read in one batch and becomes a monitored member */
        const decodedValues = await readAttributeOfMany(this.session, variableRefs.map((child) => child.nodeId))
        for (let index = 0; index < variableRefs.length; index++) {
            const child = variableRefs[index]
            const decoded = decodedValues[index]
            this._relatedNodeIds.add(child.nodeId)
            if (!decoded.ok && !decoded.statusCodeIsUncertain) continue
            this._relatedVariableNodeIds.add(child.nodeId)
            this.members.set(child.browseName, decoded.value)
            this.memberKeyByNodeId.set(child.nodeId, child.browseName)
        }

        /* §12 / §13 - the instance state machine exposes its state through CurrentState only */
        const currentState = variableRefs.find((child) => child.browseName === "CurrentState")
        if (currentState !== undefined) {
            this.currentStateNodeId = currentState.nodeId
            this.currentState = UaBuildingBlock.stateTextOf(this.members.get("CurrentState"))
        }

        for (const childRef of objectRefs) {
            this._relatedNodeIds.add(childRef.nodeId)
            const childMatch = await this.resolver.match(childRef.nodeId, [CORE_TYPES.stateType, CORE_TYPES.transitionType])
            const child: BlockChild = {
                ref: childRef,
                kind: childMatch.ref === CORE_TYPES.stateType ? "state" : childMatch.ref === CORE_TYPES.transitionType ? "transition" : "child",
                typeDefinitionNodeId: childMatch.typeDefinition?.nodeId ?? null,
                typeDefinition: childMatch.typeDefinition?.browseName ?? null,
                typeDefinitionChain: UaTypeResolver.formatChain(childMatch.chain),
                stateNumber: null,
                members: new Map(),
                memberKeyByNodeId: new Map(),
                _relatedVariableNodeIds: new Set(),
            }
            if (child.kind === "state") {
                /* Table 31 / 34 - StateNumber is declared on the state Object */
                const stateProperties = await browseProperties(this.session, childRef.nodeId)
                const stateNumberRef = stateProperties.find((property) => property.browseName === "StateNumber")
                if (stateNumberRef !== undefined) {
                    const decoded = await readAttributeOfMany(this.session, [stateNumberRef.nodeId])
                    child.stateNumber = decoded[0].ok ? Number(decoded[0].value) : null
                }
            }
            if (child.kind === "child" && this.spec.childMembers !== undefined) {
                /* §17 - read the nameplate/equipment Properties of each MachineryEquipment child */
                const childProperties = await browseProperties(this.session, childRef.nodeId)
                const childValues = await readAttributeOfMany(this.session, childProperties.map((property) => property.nodeId))
                for (let index = 0; index < childProperties.length; index++) {
                    const property = childProperties[index]
                    const decoded = childValues[index]
                    this._relatedNodeIds.add(property.nodeId)
                    if (!decoded.ok && !decoded.statusCodeIsUncertain) continue
                    child._relatedVariableNodeIds.add(property.nodeId)
                    this._relatedVariableNodeIds.add(property.nodeId)
                    child.members.set(property.browseName, decoded.value)
                    child.memberKeyByNodeId.set(property.nodeId, property.browseName)
                }
            }
            this.children.set(childRef.nodeId, child)
        }
        if (!this.matched) {
            log.debug(`UaBuildingBlock: '${this.ref.browseName}' [${this.ref.nodeId}] is a candidate for '${this.spec.key}' but its chain is '${this.match.chain.length > 0 ? UaTypeResolver.formatChain(this.match.chain) : "?"}' - reported as foreign`)
        }
        this._lastInitialization = new Date()
    }

    notify(nodeId: string, dataValue: DataValue) {
        const value = normalizeValue(dataValue.value.value)
        if (nodeId === this.currentStateNodeId) {
            this.currentState = UaBuildingBlock.stateTextOf(value)
        }
        const key = this.memberKeyByNodeId.get(nodeId)
        if (key !== undefined) {
            this.members.set(key, value)
        }
        for (const child of this.children.values()) {
            const childKey = child.memberKeyByNodeId.get(nodeId)
            if (childKey !== undefined) {
                child.members.set(childKey, value)
            }
        }
    }

    private static expectedMembersJson(members: SpecMember[], foundNames: Set<string>, variableCount: number, objectCount: number): any {
        const out: Record<string, any> = {}
        for (const member of members) {
            /* states/transitions declared 'on the TypeDefinition only' are covered by SpecStates */
            if (member.clause.includes("TypeDefinition only")) continue
            let found: boolean
            if (member.browseName.startsWith("<")) {
                found = member.nodeClass === "Variable" ? variableCount > 0 : objectCount > 0
            } else {
                found = foundNames.has(member.browseName)
            }
            out[member.browseName] = { Required: member.req, Access: member.access ?? null, Found: found }
        }
        return out
    }

    toJSON(): any {
        const childObjects = Array.from(this.children.values()).filter((child) => child.kind === "child")
        const foundNames = new Set<string>([...this.members.keys(), ...childObjects.map((child) => child.ref.browseName)])
        const json: any = {
            Block: this.spec.key,
            Spec: this.spec.spec,
            Feature: this.spec.feature,
            NodeId: this.ref.nodeId,
            BrowseName: this.ref.browseName,
            DisplayName: this.ref.displayName,
            TypeDefinitionNodeId: this.match.typeDefinition?.nodeId ?? null,
            TypeDefinition: this.match.typeDefinition?.browseName ?? null,
            TypeDefinitionChain: UaTypeResolver.formatChain(this.match.chain),
            MatchedSpecType: this.matchedBrowseName,
            MatchedSpecNodeId: this.match.matchedNodeId ?? null,
            CurrentState: this.currentState,
            CurrentStateNodeId: this.currentStateNodeId,
            SpecStates: STATE_TABLES[this.spec.key] ?? null,
            FoundStates: Array.from(this.children.values())
                .filter((child) => child.kind === "state")
                .map((child) => { return { Name: child.ref.browseName, NodeId: child.ref.nodeId, StateNumber: child.stateNumber } }),
            Members: Object.fromEntries(this.members.entries()),
            ExpectedMembers: UaBuildingBlock.expectedMembersJson(this.spec.members, foundNames, this.members.size, childObjects.length),
            Children: Array.from(this.children.values()).map((child) => {
                const childJson: any = {
                    NodeId: child.ref.nodeId,
                    BrowseName: child.ref.browseName,
                    DisplayName: child.ref.displayName,
                    NodeClass: NodeClass[child.ref.nodeClass] ?? String(child.ref.nodeClass),
                    Kind: child.kind,
                    TypeDefinitionNodeId: child.typeDefinitionNodeId,
                    TypeDefinition: child.typeDefinition,
                    TypeDefinitionChain: child.typeDefinitionChain,
                }
                if (child.kind === "state") childJson.StateNumber = child.stateNumber
                if (child.members.size > 0) {
                    childJson.Members = Object.fromEntries(child.members.entries())
                    if (this.spec.childMembers !== undefined) {
                        const childExpected = UaBuildingBlock.expectedMembersJson(
                            this.spec.childMembers,
                            new Set(child.members.keys()),
                            child.members.size,
                            0,
                        )
                        childJson.ExpectedMembers = childExpected
                    }
                }
                return childJson
            }),
        }
        if (!this.matched) {
            json.ExpectedBlock = this.spec.key
            json.Note = `BrowseName is one of the '${this.spec.spec}' instance names but the TypeDefinition chain does not reach a spec TypeRef - foreign/vendor block, reported only`
        }
        return json
    }
}
