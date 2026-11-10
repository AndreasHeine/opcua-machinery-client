import {
    AttributeIds,
    BrowseDescriptionLike,
    BrowseDirection,
    ClientSession,
    DataValue,
    LocalizedText,
    NodeClass,
    QualifiedName,
    ReferenceDescription,
    ReferenceTypeIds,
} from "node-opcua";
import { isStatusCodeGoodish, makeNodeIdStringFromExpandedNodeId } from "./ua-helper";
import { NAMESPACES, NamespaceKey, TypeRef } from "./ua-spec";
import { log } from "./config";

/*
 * Type resolution for the OPC 40001-x spec family.
 *
 * The spec identifies building blocks by their TypeDefinition and its `HasSubtype` chain, never by
 * DisplayName. A vendor may subtype `MachineryItemState_StateMachineType` (e.g.
 * `ExtrusionMachineryItemState_StateMachineType`), so matching DisplayName strings silently drops
 * those instances. This resolver walks `HasTypeDefinition` and then the inverse `HasSubtype` chain
 * and answers "is this instance a subtype of <spec type>?" instead.
 *
 * Everything is cached per session: the type hierarchy is small and shared by all 24-ish machine
 * instances, so one resolve per TypeDefinition is enough.
 */

/* Walking the HasSubtype chain is bounded: no real hierarchy is deeper than this. */
const MAX_CHAIN_DEPTH = 32;

export type TypeChainEntry = {
    nodeId: string
    browseName: string | null
    displayName: string | null
}

/* [0] is the TypeDefinition of the instance, following entries are its supertypes. */
export type TypeChain = TypeChainEntry[]

export type TypeMatch = {
    /* The spec TypeRef that matched, undefined when nothing matched. */
    ref?: TypeRef
    /* Canonical NodeId of the matched spec type on this server. */
    matchedNodeId?: string
    typeDefinition: TypeChainEntry | null
    chain: TypeChain
    /* Namespace of the instance's TypeDefinition, useful to spot foreign (vertical) types. */
    namespaceUri: string | null
}

export class UaTypeResolver {

    readonly session: ClientSession
    readonly namespaceArray: string[]

    /* canonical NodeId -> canonical NodeIds of the TypeDefinition chain (resolved lazily) */
    private chainCache: Map<string, TypeChain> = new Map()
    /* canonical NodeId -> TypeDefinition canonical NodeId */
    private typeDefinitionCache: Map<string, string | null> = new Map()
    /* canonical NodeId -> browseName / displayName of that (type) node */
    private nameCache: Map<string, TypeChainEntry> = new Map()
    /* canonical spec NodeId per TypeRef, resolved once per namespace array */
    private specNodeIdCache: Map<string, string | null> = new Map()

    constructor(session: ClientSession, namespaceArray: string[]) {
        this.session = session
        this.namespaceArray = namespaceArray
    }

    namespaceIndexOf(uri: string): number | undefined {
        const index = this.namespaceArray.indexOf(uri)
        return index === -1 ? undefined : index
    }

    namespaceUriOf(namespaceIndex: number): string | null {
        return this.namespaceArray[namespaceIndex] ?? null
    }

    /*
     * Canonical server NodeId (`ns=<index>;i=<id>`) for a spec TypeRef.
     * Returns null when the server does not implement that namespace at all -
     * that is a coverage statement, not an error.
     */
    specNodeId(ref: TypeRef): string | null {
        const cacheKey = `${ref.ns};${ref.id}`
        if (this.specNodeIdCache.has(cacheKey)) return this.specNodeIdCache.get(cacheKey)!
        const namespaceIndex = this.namespaceIndexOf(NAMESPACES[ref.ns as NamespaceKey])
        const nodeId = namespaceIndex === undefined ? null : `ns=${namespaceIndex};i=${ref.id}`
        this.specNodeIdCache.set(cacheKey, nodeId)
        return nodeId
    }

    private async readNames(nodeId: string): Promise<TypeChainEntry> {
        if (this.nameCache.has(nodeId)) return this.nameCache.get(nodeId)!
        const readResults: DataValue[] = await this.session.read([
            { nodeId, attributeId: AttributeIds.BrowseName },
            { nodeId, attributeId: AttributeIds.DisplayName },
        ])
        let browseName: string | null = null
        let displayName: string | null = null
        if (isStatusCodeGoodish(readResults[0].statusCode)) {
            browseName = (readResults[0].value.value as QualifiedName).name
        }
        if (isStatusCodeGoodish(readResults[1].statusCode)) {
            displayName = (readResults[1].value.value as LocalizedText).text
        }
        const entry: TypeChainEntry = { nodeId, browseName, displayName }
        this.nameCache.set(nodeId, entry)
        return entry
    }

    /* Forward HasTypeDefinition of an instance (or of an Object/Variable). */
    async typeDefinitionOf(nodeId: string): Promise<string | null> {
        if (this.typeDefinitionCache.has(nodeId)) return this.typeDefinitionCache.get(nodeId)!
        let typeDefinitionNodeId: string | null = null
        const browseResult = await this.session.browse({
            nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasTypeDefinition,
            includeSubtypes: false,
        } as BrowseDescriptionLike)
        const references = browseResult.references ?? []
        if (references.length > 1) {
            log.warn(`UaTypeResolver: NodeId='${nodeId}' has '${references.length}' TypeDefinition references!`)
        }
        if (references.length > 0) {
            typeDefinitionNodeId = makeNodeIdStringFromExpandedNodeId(references[0].nodeId)
        } else {
            log.debug(`UaTypeResolver: NodeId='${nodeId}' has no TypeDefinition reference!`)
        }
        this.typeDefinitionCache.set(nodeId, typeDefinitionNodeId)
        return typeDefinitionNodeId
    }

    /*
     * Inverse HasSubtype chain of a TypeDefinition.
     * The TypeDefinition itself is entry [0]; the walk stops at BaseObjectType or when the server
     * does not browse the inverse reference (some embedded servers do not).
     */
    async chainOf(typeDefinitionNodeId: string): Promise<TypeChain> {
        if (this.chainCache.has(typeDefinitionNodeId)) return this.chainCache.get(typeDefinitionNodeId)!
        const chain: TypeChain = []
        const visited = new Set<string>()
        let currentId: string | null = typeDefinitionNodeId
        while (currentId !== null && chain.length < MAX_CHAIN_DEPTH && !visited.has(currentId)) {
            visited.add(currentId)
            chain.push(await this.readNames(currentId))
            const browseResult = await this.session.browse({
                nodeId: currentId,
                browseDirection: BrowseDirection.Inverse,
                referenceTypeId: ReferenceTypeIds.HasSubtype,
                includeSubtypes: false,
            } as BrowseDescriptionLike)
            const references: ReferenceDescription[] = browseResult.references ?? []
            if (references.length === 0) {
                currentId = null
            } else {
                if (references.length > 1) {
                    log.debug(`UaTypeResolver: TypeDefinition '${currentId}' has '${references.length}' supertypes!`)
                }
                currentId = makeNodeIdStringFromExpandedNodeId(references[0].nodeId)
            }
        }
        this.chainCache.set(typeDefinitionNodeId, chain)
        return chain
    }

    /* TypeDefinition chain of an instance node. */
    async chainOfNode(nodeId: string): Promise<TypeChain> {
        const typeDefinitionNodeId = await this.typeDefinitionOf(nodeId)
        if (typeDefinitionNodeId === null) return []
        return this.chainOf(typeDefinitionNodeId)
    }

    /* All HasSubtype children of a TypeDefinition (used to enumerate vendor subtypes). */
    async subtypesOf(typeDefinitionNodeId: string): Promise<ReferenceDescription[]> {
        const browseResult = await this.session.browse({
            nodeId: typeDefinitionNodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasSubtype,
            includeSubtypes: false,
        } as BrowseDescriptionLike)
        return browseResult.references ?? []
    }

    /* HasInterface targets of a TypeDefinition (OPC 40001-1 nameplate interfaces). */
    async interfacesOf(typeDefinitionNodeId: string): Promise<ReferenceDescription[]> {
        const browseResult = await this.session.browse({
            nodeId: typeDefinitionNodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasInterface,
            includeSubtypes: false,
        } as BrowseDescriptionLike)
        return browseResult.references ?? []
    }

    /*
     * Resolve an instance and test it against a list of spec TypeRefs.
     * `refs` are checked in the given order, so callers control precedence.
     */
    async match(nodeId: string, refs: TypeRef[]): Promise<TypeMatch> {
        const typeDefinitionNodeId = await this.typeDefinitionOf(nodeId)
        if (typeDefinitionNodeId === null) {
            return { typeDefinition: null, chain: [], namespaceUri: null }
        }
        const chain = await this.chainOf(typeDefinitionNodeId)
        const wanted = new Map<string, TypeRef>()
        for (const ref of refs) {
            const specNodeId = this.specNodeId(ref)
            if (specNodeId !== null) wanted.set(specNodeId, ref)
        }
        for (const entry of chain) {
            const ref = wanted.get(entry.nodeId)
            if (ref !== undefined) {
                const namespaceIndex = Number(entry.nodeId.slice(3, entry.nodeId.indexOf(';')))
                return {
                    ref,
                    matchedNodeId: entry.nodeId,
                    typeDefinition: chain[0],
                    chain,
                    namespaceUri: this.namespaceUriOf(namespaceIndex),
                }
            }
        }
        return {
            typeDefinition: chain[0] ?? null,
            chain,
            namespaceUri: chain.length > 0 ? this.namespaceUriOf(namespaceIndexOf(chain[0].nodeId)) : null,
        }
    }

    /* Convenience for the "is this a Variable/Object/Method?" question. */
    async nodeClassOf(nodeId: string): Promise<NodeClass | null> {
        const readResult: DataValue = await this.session.read({ nodeId, attributeId: AttributeIds.NodeClass })
        if (!isStatusCodeGoodish(readResult.statusCode)) return null
        return readResult.value.value as NodeClass
    }

    /* Human readable chain for the startup log. */
    static formatChain(chain: TypeChain): string {
        return chain.map((entry) => `${entry.browseName ?? entry.displayName ?? "?"} [${entry.nodeId}]`).join(' <- ')
    }
}

function namespaceIndexOf(nodeIdString: string): number {
    const match = /^ns=(\d+);/.exec(nodeIdString)
    return match === null ? 0 : Number(match[1])
}
