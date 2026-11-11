import {
    AttributeIds,
    ClientSession,
    DataValue,
    NodeClass,
    ReferenceTypeIds,
} from "node-opcua";
import { log } from "./config";
import { browseChildByBrowseName, browseComponents, browseOrganized, browseProperties, isMethodNode, isObjectNode, isVariableNode, UaRef } from "./ua-browse";
import { normalizeValue, readAttributeOfMany, readAttributes } from "./ua-read";
import { CORE_TYPES, TypeRef } from "./ua-spec";
import {
    JOB_MANAGEMENT_CHILDREN,
    JOB_MANAGEMENT_PROPERTIES,
    JOB_MANAGEMENT_TYPE_REFS,
    JOB_ORDER_CONTROL_MEMBERS,
    JOB_ORDER_RESULTS_MEMBERS,
} from "./ua-spec-jobs";
import { TypeMatch, UaTypeResolver } from "./ua-types";

/*
 * OPC 40001-3 8.1 + OPC 10031-4 6.2 - the JobManagement AddIn, read-only observation.
 *
 * JobManagementType wraps the two ISA-95 job control Objects JobOrderControl
 * (ISA95JobOrderReceiverObjectType) and JobOrderResults (ISA95JobResponseProviderObjectType). Their
 * list Variables (JobOrderList / WorkMaster / ID lists / JobOrderResponseList) are read and monitored,
 * their control Methods (Store, Start, Pause, ...) are reported with their InputArguments /
 * OutputArguments declarations (OPC 10000-3 MethodType) but NEVER called - the write side of OPC 40001-3
 * is deliberately out of scope.
 *
 * Like the §12/§13 state machines, the receiver's state Objects + transitions exist on the
 * TypeDefinition only; the instance exposes CurrentState - which per OPC 10031-4 6.2.1.2 shall always
 * return a Bad StatusCode (the receiver is state metadata, the real job states are entries of
 * JobOrderList). A server that returns Good there is a deviation and is recorded as one.
 */

export type JobMemberSpec = {
    browseName: string
    dataType: string
    occurrence: string
    access: string
    feature: string
    clause: string
    description?: string
}

export type JobMethodSpec = {
    browseName: string
    occurrence: string
    clause: string
}

/* Everything one of the two ISA-95 container Objects declares, assembled from the registry. */
export type JobContainerDeclaration = {
    browseName: string
    typeRef: TypeRef
    feature: string
    clause: string
    variables: JobMemberSpec[]
    properties: JobMemberSpec[]
    methods: JobMethodSpec[]
    specStates: { name: string; stateNumber: number }[]
    generatesEvent: TypeRef | null
}

export type JobMember = {
    nodeId: string
    browseName: string
    displayName: string | null
    nodeClass: string
    /* true when the BrowseName matches a Variable-/Property entry of the registry table */
    declared: boolean
    feature: string | null
    clause: string | null
    value: any
    statusCode: string
}

export type JobMethodReport = {
    nodeId: string
    browseName: string
    displayName: string | null
    declared: boolean
    clause: string | null
    /* Argument / ArgumentDescription arrays of the Method's InputArguments / OutputArguments Properties */
    inputArgs: any | null
    outputArgs: any | null
    note: string
}

function controlDeclaration(): JobContainerDeclaration {
    return {
        browseName: "JobOrderControl",
        typeRef: JOB_MANAGEMENT_CHILDREN[0].typeRef,
        feature: JOB_MANAGEMENT_CHILDREN[0].feature,
        clause: JOB_MANAGEMENT_CHILDREN[0].clause,
        variables: JOB_ORDER_CONTROL_MEMBERS.variables,
        properties: JOB_ORDER_CONTROL_MEMBERS.properties,
        methods: JOB_ORDER_CONTROL_MEMBERS.methods,
        specStates: JOB_ORDER_CONTROL_MEMBERS.states.map((name: string) => {
            return { name, stateNumber: JOB_ORDER_CONTROL_MEMBERS.stateNumbers[name] }
        }),
        generatesEvent: null,
    }
}

function resultsDeclaration(): JobContainerDeclaration {
    return {
        browseName: "JobOrderResults",
        typeRef: JOB_MANAGEMENT_CHILDREN[1].typeRef,
        feature: JOB_MANAGEMENT_CHILDREN[1].feature,
        clause: JOB_MANAGEMENT_CHILDREN[1].clause,
        variables: JOB_ORDER_RESULTS_MEMBERS.variables,
        properties: JOB_ORDER_RESULTS_MEMBERS.properties,
        methods: JOB_ORDER_RESULTS_MEMBERS.methods,
        specStates: [],
        generatesEvent: JOB_ORDER_RESULTS_MEMBERS.generatesEvent,
    }
}

/*
 * One ISA-95 container Object (JobOrderControl or JobOrderResults). A container whose chain does not
 * reach the declared ISA-95 TypeRef is still loaded and reported - deviation, not coverage.
 */
export class UaJobOrderContainer {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly ref: UaRef
    readonly match: TypeMatch
    readonly declaration: JobContainerDeclaration

    readonly members: Map<string, JobMember> = new Map()

    readonly methods: Map<string, JobMethodReport> = new Map()

    /**
     * Value of the inherited CurrentState Variable (state machine metadata).
     */
    currentState: string | null = null

    currentStateNodeId: string | null = null

    currentStateStatusCode: string | null = null

    /**
     * State / Transition Objects found on the instance (normally absent - they exist on the
     * TypeDefinition only, like the 40001-1 §12/§13 states).
     */
    readonly foundStates: { name: string; nodeId: string; stateNumber: number | null }[] = []

    readonly foundTransitions: { name: string; nodeId: string }[] = []

    _relatedNodeIds = new Set<string>()

    _relatedVariableNodeIds = new Set<string>()

    /* NodeId -> BrowseName of the monitored Variable members, used by notify() */
    private memberKeyByNodeId: Map<string, string> = new Map()

    constructor(session: ClientSession, resolver: UaTypeResolver, ref: UaRef, declaration: JobContainerDeclaration, match: TypeMatch) {
        this.session = session
        this.resolver = resolver
        this.ref = ref
        this.declaration = declaration
        this.match = match
        this._relatedNodeIds.add(ref.nodeId)
    }

    get specMatch(): boolean {
        return this.match.ref !== undefined
    }

    async initialize() {
        const components = await browseComponents(this.session, this.ref.nodeId)
        const properties = await browseProperties(this.session, this.ref.nodeId)
        const childrenById = new Map<string, UaRef>()
        for (const child of [...components, ...properties]) {
            if (!childrenById.has(child.nodeId)) childrenById.set(child.nodeId, child)
        }

        const variableRefs = Array.from(childrenById.values()).filter((child) => isVariableNode(child.nodeClass))
        const decodedValues = await readAttributeOfMany(this.session, variableRefs.map((child) => child.nodeId))
        for (let index = 0; index < variableRefs.length; index++) {
            const child = variableRefs[index]
            const decoded = decodedValues[index]
            this._relatedNodeIds.add(child.nodeId)
            /* HasComponent list Variables and HasProperty metadata are read in the same batch; only
               the declared list Variables are monitored, Properties are static metadata */
            const variableSpec = this.declaration.variables.find((variable) => variable.browseName === child.browseName)
            const propertySpec = this.declaration.properties.find((property) => property.browseName === child.browseName)
            const specEntry = variableSpec ?? propertySpec
            if (specEntry === undefined) {
                log.debug(`UaJobOrderContainer: '${this.ref.browseName}' [${this.ref.nodeId}] Variable child '${child.browseName}' [${child.nodeId}] is not declared by '${this.declaration.clause}', kept as vendor extension`)
            }
            this.members.set(child.browseName, {
                nodeId: child.nodeId,
                browseName: child.browseName,
                displayName: child.displayName,
                nodeClass: NodeClass[child.nodeClass] ?? String(child.nodeClass),
                declared: specEntry !== undefined,
                feature: specEntry?.feature ?? null,
                clause: specEntry?.clause ?? null,
                value: decoded.value,
                statusCode: decoded.statusCode,
            })
            if (variableSpec === undefined) continue
            if (!decoded.ok && !decoded.statusCodeIsUncertain) continue
            this._relatedVariableNodeIds.add(child.nodeId)
            this.memberKeyByNodeId.set(child.nodeId, child.browseName)
        }

        const currentState = this.members.get("CurrentState")
        if (currentState !== undefined) {
            this.currentStateNodeId = currentState.nodeId
            this.currentState = currentState.value === null || currentState.value === undefined ? null : `${currentState.value}`
            this.currentStateStatusCode = currentState.statusCode
        }

        /* state / transition Objects, when the server puts them on the instance */
        for (const childRef of Array.from(childrenById.values()).filter((child) => isObjectNode(child.nodeClass))) {
            this._relatedNodeIds.add(childRef.nodeId)
            const childMatch = await this.resolver.match(childRef.nodeId, [CORE_TYPES.stateType, CORE_TYPES.transitionType])
            if (childMatch.ref === CORE_TYPES.stateType) {
                const stateNumberRef = await browseChildByBrowseName(this.session, childRef.nodeId, "StateNumber", ReferenceTypeIds.HasProperty)
                let stateNumber: number | null = null
                if (stateNumberRef !== null) {
                    const decoded = await readAttributeOfMany(this.session, [stateNumberRef.nodeId])
                    stateNumber = decoded[0].ok ? Number(decoded[0].value) : null
                }
                this.foundStates.push({ name: childRef.browseName, nodeId: childRef.nodeId, stateNumber })
            } else if (childMatch.ref === CORE_TYPES.transitionType) {
                this.foundTransitions.push({ name: childRef.browseName, nodeId: childRef.nodeId })
            } else {
                log.debug(`UaJobOrderContainer: '${this.ref.browseName}' [${this.ref.nodeId}] Object child '${childRef.browseName}' [${childRef.nodeId}] chain '${UaTypeResolver.formatChain(childMatch.chain)}' is neither a state nor a transition`)
            }
        }

        /* Methods: presence + InputArguments / OutputArguments declarations (OPC 10000-3), never called */
        for (const childRef of Array.from(childrenById.values()).filter((child) => isMethodNode(child.nodeClass))) {
            this._relatedNodeIds.add(childRef.nodeId)
            const specEntry = this.declaration.methods.find((method) => method.browseName === childRef.browseName)
            if (specEntry === undefined) {
                log.debug(`UaJobOrderContainer: '${this.ref.browseName}' [${this.ref.nodeId}] Method child '${childRef.browseName}' [${childRef.nodeId}] is not declared by '${this.declaration.clause}', kept as vendor extension`)
            }
            const method: JobMethodReport = {
                nodeId: childRef.nodeId,
                browseName: childRef.browseName,
                displayName: childRef.displayName,
                declared: specEntry !== undefined,
                clause: specEntry?.clause ?? null,
                inputArgs: null,
                outputArgs: null,
                note: "Method availability reported only - this client is read-only and never calls Methods",
            }
            const inputArgsRef = await browseChildByBrowseName(this.session, childRef.nodeId, "InputArguments", ReferenceTypeIds.HasProperty)
            if (inputArgsRef !== null) {
                const decoded = (await readAttributes(this.session, inputArgsRef.nodeId, [AttributeIds.Value]))[0]
                method.inputArgs = decoded.value
                this._relatedNodeIds.add(inputArgsRef.nodeId)
            }
            const outputArgsRef = await browseChildByBrowseName(this.session, childRef.nodeId, "OutputArguments", ReferenceTypeIds.HasProperty)
            if (outputArgsRef !== null) {
                const decoded = (await readAttributes(this.session, outputArgsRef.nodeId, [AttributeIds.Value]))[0]
                method.outputArgs = decoded.value
                this._relatedNodeIds.add(outputArgsRef.nodeId)
            }
            this.methods.set(childRef.nodeId, method)
        }

        if (!this.specMatch) {
            log.debug(`UaJobOrderContainer: '${this.ref.browseName}' [${this.ref.nodeId}] is expected to be a '${this.declaration.typeRef.browseName}' but its chain is '${UaTypeResolver.formatChain(this.match.chain)}' - reported as foreign`)
        }
    }

    notify(nodeId: string, dataValue: DataValue) {
        const value = normalizeValue(dataValue.value.value)
        const key = this.memberKeyByNodeId.get(nodeId)
        if (key === undefined) return
        const member = this.members.get(key)
        if (member === undefined) return
        member.value = value
        member.statusCode = `${dataValue.statusCode.name ?? dataValue.statusCode.toString()}`
        if (key === "CurrentState") {
            this.currentState = value === null || value === undefined ? null : `${value}`
            this.currentStateStatusCode = member.statusCode
        }
    }

    toJSON(): any {
        const foundNames = new Set<string>([...this.members.keys()])
        const foundMethods = new Set<string>(Array.from(this.methods.values()).map((method) => method.browseName))
        const expectedMembers: Record<string, any> = {}
        for (const variable of this.declaration.variables) {
            expectedMembers[variable.browseName] = { Required: variable.occurrence, Access: variable.access, Found: foundNames.has(variable.browseName) }
        }
        for (const property of this.declaration.properties) {
            expectedMembers[property.browseName] = { Required: property.occurrence, Access: property.access, Found: foundNames.has(property.browseName) }
        }
        for (const method of this.declaration.methods) {
            expectedMembers[method.browseName] = { Required: method.occurrence, Access: "call", Found: foundMethods.has(method.browseName) }
        }
        const json: any = {
            NodeId: this.ref.nodeId,
            BrowseName: this.ref.browseName,
            DisplayName: this.ref.displayName,
            SpecEntry: { BrowseName: this.declaration.browseName, TypeDefinition: this.declaration.typeRef.browseName, Clause: this.declaration.clause },
            TypeDefinitionNodeId: this.match.typeDefinition?.nodeId ?? null,
            TypeDefinition: this.match.typeDefinition?.browseName ?? null,
            TypeDefinitionChain: UaTypeResolver.formatChain(this.match.chain),
            MatchedSpecType: this.match.ref?.browseName ?? null,
            MatchedSpecNodeId: this.match.matchedNodeId ?? null,
            CurrentState: this.currentState,
            CurrentStateNodeId: this.currentStateNodeId,
            CurrentStateStatusCode: this.currentStateStatusCode,
            SpecStates: this.declaration.specStates.length > 0 ? this.declaration.specStates : null,
            FoundStates: this.foundStates,
            FoundTransitions: this.foundTransitions,
            Members: Array.from(this.members.values()).map((member) => {
                return {
                    NodeId: member.nodeId,
                    BrowseName: member.browseName,
                    DisplayName: member.displayName,
                    NodeClass: member.nodeClass,
                    Declared: member.declared,
                    Feature: member.feature,
                    Clause: member.clause,
                    Value: member.value,
                    StatusCode: member.statusCode,
                }
            }),
            ExpectedMembers: expectedMembers,
            Methods: Array.from(this.methods.values()).map((method) => {
                return {
                    NodeId: method.nodeId,
                    BrowseName: method.browseName,
                    DisplayName: method.displayName,
                    Declared: method.declared,
                    Clause: method.clause,
                    InputArguments: method.inputArgs,
                    OutputArguments: method.outputArgs,
                    Note: method.note,
                }
            }),
            GeneratesEvent: this.declaration.generatesEvent?.browseName ?? null,
        }
        /* OPC 10031-4 6.2.1.2: the receiver's CurrentState shall always return Bad - Good is a deviation */
        if (this.currentStateStatusCode !== null && this.currentStateStatusCode.startsWith("Good")) {
            json.CurrentStateNote = "server returns StatusCode 'Good' although OPC 10031-4 6.2.1.2 requires the inherited CurrentState of ISA95JobOrderReceiverObjectType to always return a Bad StatusCode (state Objects are metadata only, the real job states are the entries of JobOrderList)"
        }
        if (!this.specMatch) {
            json.ExpectedContainer = this.declaration.browseName
            json.Note = `BrowseName matches OPC 40001-3 8.1 Table 4 but the TypeDefinition chain does not reach '${this.declaration.typeRef.browseName}' - foreign/vendor container, reported only`
        }
        return json
    }
}

/*
 * The JobManagementType AddIn of one machine (OPC 40001-3 8.1 Table 4).
 */
export class UaJobManagement {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly ref: UaRef
    readonly match: TypeMatch

    /* Assigned during initialize() - the two ISA-95 containers of this AddIn */
    control: UaJobOrderContainer | null = null

    results: UaJobOrderContainer | null = null

    /* AddIn-level Properties (DefaultInstanceBrowseName) */
    private readonly properties: Map<string, JobMember> = new Map()

    _relatedNodeIds = new Set<string>()

    _relatedVariableNodeIds = new Set<string>()

    constructor(session: ClientSession, resolver: UaTypeResolver, ref: UaRef, match: TypeMatch) {
        this.session = session
        this.resolver = resolver
        this.ref = ref
        this.match = match
        this._relatedNodeIds.add(ref.nodeId)
    }

    get matched(): boolean {
        return this.match.ref !== undefined
    }

    async initialize() {
        const components = await browseComponents(this.session, this.ref.nodeId)
        const properties = await browseProperties(this.session, this.ref.nodeId)

        for (const childRef of components) {
            const specEntry = JOB_MANAGEMENT_CHILDREN.find((entry) => entry.browseName === childRef.browseName)
            if (specEntry === undefined || !isObjectNode(childRef.nodeClass)) continue
            const childMatch = await this.resolver.match(childRef.nodeId, [specEntry.typeRef])
            const container = new UaJobOrderContainer(this.session, this.resolver, childRef, specEntry.browseName === "JobOrderControl" ? controlDeclaration() : resultsDeclaration(), childMatch)
            await container.initialize()
            container._relatedNodeIds.forEach((nodeId) => this._relatedNodeIds.add(nodeId))
            container._relatedVariableNodeIds.forEach((nodeId) => this._relatedVariableNodeIds.add(nodeId))
            if (specEntry.browseName === "JobOrderControl") this.control = container
            else this.results = container
        }

        const declaredProperties = properties.filter((child) => JOB_MANAGEMENT_PROPERTIES.some((entry) => entry.browseName === child.browseName) && isVariableNode(child.nodeClass))
        const propertyValues = await readAttributeOfMany(this.session, declaredProperties.map((child) => child.nodeId))
        for (let index = 0; index < declaredProperties.length; index++) {
            const child = declaredProperties[index]
            const decoded = propertyValues[index]
            const specEntry = JOB_MANAGEMENT_PROPERTIES.find((entry) => entry.browseName === child.browseName)!
            this._relatedNodeIds.add(child.nodeId)
            this.properties.set(child.browseName, {
                nodeId: child.nodeId,
                browseName: child.browseName,
                displayName: child.displayName,
                nodeClass: NodeClass[child.nodeClass] ?? String(child.nodeClass),
                declared: true,
                feature: specEntry.feature,
                clause: specEntry.clause,
                value: decoded.value,
                statusCode: decoded.statusCode,
            })
        }
    }

    notify(nodeId: string, dataValue: DataValue) {
        if (this.control !== null) this.control.notify(nodeId, dataValue)
        if (this.results !== null) this.results.notify(nodeId, dataValue)
    }

    toJSON(): any {
        const expectedAddInMembers: Record<string, any> = {}
        for (const entry of JOB_MANAGEMENT_CHILDREN) {
            expectedAddInMembers[entry.browseName] = { Required: entry.occurrence, Found: entry.browseName === "JobOrderControl" ? this.control !== null : this.results !== null }
        }
        for (const entry of JOB_MANAGEMENT_PROPERTIES) {
            expectedAddInMembers[entry.browseName] = { Required: entry.occurrence, Found: this.properties.has(entry.browseName) }
        }
        return {
            NodeId: this.ref.nodeId,
            BrowseName: this.ref.browseName,
            DisplayName: this.ref.displayName,
            TypeDefinitionNodeId: this.match.typeDefinition?.nodeId ?? null,
            TypeDefinition: this.match.typeDefinition?.browseName ?? null,
            TypeDefinitionChain: UaTypeResolver.formatChain(this.match.chain),
            TypeDefinitionNamespaceUri: this.match.namespaceUri,
            MatchedSpecType: this.match.ref?.browseName ?? null,
            MatchedSpecNodeId: this.match.matchedNodeId ?? null,
            Members: Object.fromEntries(Array.from(this.properties.values()).map((property) => {
                return [property.browseName, { NodeId: property.nodeId, Value: property.value, StatusCode: property.statusCode }]
            })),
            ExpectedAddInMembers: expectedAddInMembers,
            JobOrderControl: this.control !== null ? this.control.toJSON() : null,
            JobOrderResults: this.results !== null ? this.results.toJSON() : null,
        }
    }
}

/*
 * A candidate that carries a job-management BrowseName ('JobManagement', vendor alias 'Jobs') but whose
 * TypeDefinition chain does not reach JobManagementType / the ISA-95 types (demo: the PlasticsRubber
 * IMM2MES 'JobsType' on the umati server). Reported with its direct children (names only - vertical
 * companion-spec content is out of the 40001-1/-2/-3 scope), never modelled, never subscribed.
 */
export class UaForeignJobManagement {

    private session: ClientSession
    private resolver: UaTypeResolver
    readonly ref: UaRef
    readonly match: TypeMatch
    readonly reason: string

    readonly children: { nodeId: string; browseName: string; displayName: string | null; nodeClass: string }[] = []

    _relatedNodeIds = new Set<string>()

    constructor(session: ClientSession, resolver: UaTypeResolver, ref: UaRef, match: TypeMatch, reason: string) {
        this.session = session
        this.resolver = resolver
        this.ref = ref
        this.match = match
        this.reason = reason
        this._relatedNodeIds.add(ref.nodeId)
    }

    async initialize() {
        const childRefs = [
            ...await browseComponents(this.session, this.ref.nodeId),
            ...await browseOrganized(this.session, this.ref.nodeId),
        ]
        for (const childRef of childRefs) {
            this.children.push({
                nodeId: childRef.nodeId,
                browseName: childRef.browseName,
                displayName: childRef.displayName,
                nodeClass: NodeClass[childRef.nodeClass] ?? String(childRef.nodeClass),
            })
        }
    }

    toJSON(): any {
        return {
            NodeId: this.ref.nodeId,
            BrowseName: this.ref.browseName,
            DisplayName: this.ref.displayName,
            Reason: this.reason,
            TypeDefinitionNodeId: this.match.typeDefinition?.nodeId ?? null,
            TypeDefinition: this.match.typeDefinition?.browseName ?? null,
            TypeDefinitionChain: UaTypeResolver.formatChain(this.match.chain),
            TypeDefinitionNamespaceUri: this.match.namespaceUri,
            SpecTypeRefs: JOB_MANAGEMENT_TYPE_REFS.map((typeRef) => typeRef.browseName),
            Children: this.children,
        }
    }
}
