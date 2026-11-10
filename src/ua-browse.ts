import {
    BrowseDescriptionLike,
    BrowseDirection,
    BrowseResult,
    ClientSession,
    ExpandedNodeId,
    NodeClass,
    ReferenceDescription,
    ReferenceTypeIds,
} from "node-opcua";
import { isStatusCodeGoodish, makeNodeIdStringFromExpandedNodeId } from "./ua-helper";
import { log } from "./config";

/*
 * Browse helpers.
 *
 * A BrowseResult already carries nodeClass, browseName and displayName for every reference, so the
 * models do not need one read per child to decide "is this a Variable or an Object?" - that was the
 * old pattern and it costs a round trip per child node.
 *
 * All helpers return `UaRef` with the canonical NodeId string (`ns=<index>;i=<n>`) produced by
 * makeNodeIdStringFromExpandedNodeId(). Those strings are the key convention of this repo: they key
 * the machine/component/processvalue maps, _relatedNodeIdMap and _relatedVariableNodeIds, and they
 * are matched against monitoredItem.itemToMonitor.nodeId.toString().
 */

export type UaRef = {
    /* canonical NodeId string, safe as a Map key */
    nodeId: string
    expandedNodeId: ExpandedNodeId
    referenceTypeId: string
    /* BrowseName without the namespace prefix, e.g. "MachineryBuildingBlocks" */
    browseName: string
    browseNameNamespaceIndex: number
    displayName: string | null
    nodeClass: NodeClass
}

export type BrowseOptions = {
    /* default: HasComponent */
    referenceTypeId?: number
    /* default: Forward */
    browseDirection?: BrowseDirection
    /* filter the returned references by NodeClass client-side */
    nodeClass?: NodeClass[]
    /* filter the returned references by BrowseName (case sensitive, spec behaviour) */
    browseName?: string
    includeSubtypes?: boolean
    maxResultsPerBrowse?: number
}

function canonicalReferenceTypeId(ref: ReferenceDescription): string {
    return makeNodeIdStringFromExpandedNodeId(ref.referenceTypeId)
}

function toUaRef(ref: ReferenceDescription): UaRef {
    return {
        nodeId: makeNodeIdStringFromExpandedNodeId(ref.nodeId),
        expandedNodeId: ref.nodeId,
        referenceTypeId: canonicalReferenceTypeId(ref),
        browseName: `${ref.browseName.name}`,
        browseNameNamespaceIndex: ref.browseName.namespaceIndex,
        displayName: ref.displayName === undefined || ref.displayName === null ? null : `${ref.displayName.text}`,
        nodeClass: ref.nodeClass,
    }
}

export function isVariableNode(nodeClass: NodeClass): boolean {
    return nodeClass === NodeClass.Variable || nodeClass === NodeClass.VariableType
}

export function isObjectNode(nodeClass: NodeClass): boolean {
    return nodeClass === NodeClass.Object || nodeClass === NodeClass.ObjectType
}

export function isMethodNode(nodeClass: NodeClass): boolean {
    return nodeClass === NodeClass.Method
}

/*
 * Browse the children of a node and normalize them.
 * An empty array is a normal result (servers answer empty reference lists for optional children);
 * only browse errors that are not Good/uncertain are reported.
 *
 * resultMask must be requested explicitly: with the default mask the server returns bare NodeIds and
 * browseName / displayName / nodeClass stay empty, which would make every NodeClass or BrowseName
 * filter here silently return nothing. 63 = ReferenceType|NodeClass|BrowseName|DisplayName|Definition.
 */
const BROWSE_RESULT_MASK_ALL = 63;

export async function browseChildren(session: ClientSession, nodeId: string, options: BrowseOptions = {}): Promise<UaRef[]> {
    const referenceTypeId = options.referenceTypeId ?? ReferenceTypeIds.HasComponent
    const browseDirection = options.browseDirection ?? BrowseDirection.Forward
    const includeSubtypes = options.includeSubtypes ?? true
    const results: UaRef[] = []
    let continuationPoint: Buffer | undefined = undefined
    let guard = 0
    do {
        const browseResult: BrowseResult = await session.browse({
            nodeId,
            browseDirection,
            referenceTypeId,
            includeSubtypes,
            resultMask: BROWSE_RESULT_MASK_ALL,
            ...(continuationPoint === undefined ? {} : { continuationPoint, abort: false }),
        } as BrowseDescriptionLike)
        if (!isStatusCodeGoodish(browseResult.statusCode)) {
            log.debug(`browseChildren: NodeId='${nodeId}' referenceTypeId='${referenceTypeId}' statusCode='${browseResult.statusCode.toString()}'`)
            return results
        }
        for (const reference of browseResult.references ?? []) {
            const child = toUaRef(reference)
            if (options.nodeClass !== undefined && !options.nodeClass.includes(child.nodeClass)) continue
            if (options.browseName !== undefined && child.browseName !== options.browseName) continue
            results.push(child)
        }
        continuationPoint = browseResult.continuationPoint ?? undefined
        if (continuationPoint !== undefined && options.maxResultsPerBrowse !== undefined && results.length >= options.maxResultsPerBrowse) {
            /* release the continuation point so the server does not hold the browse state */
            await session.browse({ nodeId, browseDirection, referenceTypeId, abort: true } as BrowseDescriptionLike).catch(() => undefined)
            continuationPoint = undefined
        }
        guard++
    } while (continuationPoint !== undefined && guard < 100)
    return results
}

export async function browseComponents(session: ClientSession, nodeId: string): Promise<UaRef[]> {
    return browseChildren(session, nodeId, { referenceTypeId: ReferenceTypeIds.HasComponent })
}

export async function browseProperties(session: ClientSession, nodeId: string): Promise<UaRef[]> {
    return browseChildren(session, nodeId, { referenceTypeId: ReferenceTypeIds.HasProperty })
}

export async function browseAddIns(session: ClientSession, nodeId: string): Promise<UaRef[]> {
    return browseChildren(session, nodeId, { referenceTypeId: ReferenceTypeIds.HasAddIn })
}

export async function browseOrganized(session: ClientSession, nodeId: string): Promise<UaRef[]> {
    return browseChildren(session, nodeId, { referenceTypeId: ReferenceTypeIds.Organizes })
}

/* Hierarchical children (HasComponent / HasProperty / HasAddIn / Organizes / HasSubtype ...) */
export async function browseHierarchicalChildren(session: ClientSession, nodeId: string): Promise<UaRef[]> {
    return browseChildren(session, nodeId, { referenceTypeId: ReferenceTypeIds.HierarchicalReferences })
}

/* Convenience for the "one well-known child" case (DefaultInstanceBrowseName lookups). */
export async function browseChildByBrowseName(session: ClientSession, nodeId: string, browseName: string, referenceTypeId: number = ReferenceTypeIds.HasComponent): Promise<UaRef | null> {
    const children = await browseChildren(session, nodeId, { referenceTypeId, browseName })
    return children.length === 0 ? null : children[0]
}

/* Collect the canonical NodeId strings of every hierarchical descendant (bounded). */
export async function collectDescendants(session: ClientSession, nodeId: string, maxDepth: number = 4): Promise<string[]> {
    const found = new Set<string>()
    const queue: { nodeId: string; depth: number }[] = [{ nodeId, depth: 0 }]
    while (queue.length > 0) {
        const current = queue.shift()!
        if (current.depth >= maxDepth) continue
        const children = await browseHierarchicalChildren(session, current.nodeId)
        for (const child of children) {
            if (found.has(child.nodeId)) continue
            found.add(child.nodeId)
            queue.push({ nodeId: child.nodeId, depth: current.depth + 1 })
        }
    }
    return Array.from(found)
}
