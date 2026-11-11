import {
    ClientSession,
    NodeClass,
} from "node-opcua";
import { UaRef, browseComponents, browseOrganized, browseProperties, isVariableNode } from "./ua-browse";
import { TypeMatch, UaTypeResolver } from "./ua-types";
import { readAttributeOfMany } from "./ua-read";

/*
 * OPC 40001-2 / 40001-1 §16 - monitoring content that is NOT a ProcessValueType instance.
 *
 * The umati demo server fills its Monitoring folders with MachineTool / LaserSystems / PlasticsRubber
 * companion-spec types (ChannelMonitoringType, Stacklight, ...) or with vendor ProcessValueType clones
 * that live in a foreign namespace. The scope of this client is 40001-1/-2/-3, so those nodes are not
 * modelled node-by-node - but dropping them would make the demo look empty. A ForeignMonitoringType
 * entry therefore records: who the node is (BrowseName, NodeId, TypeDefinition + full HasSubtype chain,
 * TypeDefinition namespace), where it was found (which block), and the Values of its direct Variable
 * children, so the content stays visible in output.json and GET /machines.
 *
 * Read-only: nothing below such a node is subscribed or written; the child values are one read at
 * discovery time.
 */

export type ForeignMonitoringChild = {
    nodeId: string
    browseName: string
    displayName: string | null
    nodeClass: string
    /* decoded Value for Variable children, null for Object children and failed reads */
    value: any
    statusCode: string | null
}

export class UaForeignMonitoringType {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly ref: UaRef
    readonly match: TypeMatch
    /* the building block (or machine) this candidate was found under */
    readonly foundUnder: string
    readonly reason: string

    readonly children: ForeignMonitoringChild[] = []

    /* only the reported Object NodeIds - child Variables are deliberately NOT subscribed */
    _relatedNodeIds = new Set<string>()

    constructor(session: ClientSession, resolver: UaTypeResolver, ref: UaRef, match: TypeMatch, foundUnder: string, reason: string) {
        this.session = session
        this.resolver = resolver
        this.ref = ref
        this.match = match
        this.foundUnder = foundUnder
        this.reason = reason
        this._relatedNodeIds.add(ref.nodeId)
    }

    async initialize() {
        const childRefs = [
            ...await browseComponents(this.session, this.ref.nodeId),
            ...await browseProperties(this.session, this.ref.nodeId),
            ...await browseOrganized(this.session, this.ref.nodeId),
        ]
        const variableRefs = childRefs.filter((child) => isVariableNode(child.nodeClass))
        const values = await readAttributeOfMany(this.session, variableRefs.map((child) => child.nodeId))
        const valueByNodeId = new Map<string, { value: any; statusCode: string }>()
        values.forEach((decoded, index) => valueByNodeId.set(variableRefs[index].nodeId, { value: decoded.value, statusCode: decoded.statusCode }))
        for (const child of childRefs) {
            const decoded = valueByNodeId.get(child.nodeId)
            this.children.push({
                nodeId: child.nodeId,
                browseName: child.browseName,
                displayName: child.displayName,
                nodeClass: NodeClass[child.nodeClass] ?? String(child.nodeClass),
                value: decoded?.value ?? null,
                statusCode: decoded?.statusCode ?? null,
            })
        }
    }

    toJSON(): any {
        return {
            NodeId: this.ref.nodeId,
            BrowseName: this.ref.browseName,
            DisplayName: this.ref.displayName,
            FoundUnder: this.foundUnder,
            Reason: this.reason,
            TypeDefinitionNodeId: this.match.typeDefinition?.nodeId ?? null,
            TypeDefinition: this.match.typeDefinition?.browseName ?? null,
            TypeDefinitionChain: UaTypeResolver.formatChain(this.match.chain),
            TypeDefinitionNamespaceUri: this.match.namespaceUri,
            Children: this.children.map((child) => {
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
    }
}
