import { 
    OPCUAClient,
    OPCUAClientOptions,
    ClientSession,
    CreateSubscriptionRequestOptions,
    UserIdentityInfo,
    DataValue,
    StatusCode,
    AttributeIds,
    ClientMonitoredItem,
    DiagnosticInfo,
    ObjectIds,
    ServerState, 
    TimestampsToReturn,
    constructEventFilter,
    ofType,
    ClientSubscription,
    BrowseDescriptionLike,
    BrowseDirection,
    ReferenceTypeIds,
    Variant,
    ChannelSecurityToken,
    NotificationMessage,
    ReadValueIdOptions,
    ServerStatusDataType,
} from 'node-opcua'
import { 
    isStatusCodeGoodish,
    makeNodeIdStringFromExpandedNodeId
} from './ua-helper';
import { writeJson } from 'fs-extra';
import { UaMachineryMachine } from './ua-machine';
import { UaMachineryComponent } from './ua-machine-component';
import { UaProcessValue } from './ua-processvalue';
import { UaTypeResolver } from './ua-types';
import { clearInterval } from 'timers';
import { config, log } from './config';

const optionsInitial: OPCUAClientOptions = {
    //     /**
    //  * the requested session timeout in CreateSession (ms)
    //  *
    //  * Note:
    //  *    - make sure that this value is large enough, especially larger than the
    //  *      time between two transactions to the server.
    //  *
    //  *    - If your client establishes a subscription with the server, make sure that
    //  *      (maxKeepAliveCount * publishingInterval) calculated with negotiated values
    //  *      from the server  stay by large below the session time out, as you make
    //  *      encountered unexpected behavior.
    //  *
    //  * @default 60000 - default value is 60 secondes
    //  */
    //     requestedSessionTimeout?: number;
    //     /**
    //      *  @deprecated(use endpointMustExist instead)
    //      */
    //     endpoint_must_exist?: boolean;
    //     /**
    //      * set to false if the client should accept server endpoint mismatch
    //      * @default true
    //      */
    //     endpointMustExist?: boolean;
    //     connectionStrategy?: ConnectionStrategyOptions;
    //     /** the server certificate. */
    //     serverCertificate?: Certificate;
    //     /***
    //      * default secure token lifetime in ms
    //      */
    //     defaultSecureTokenLifetime?: number;
    //     /**
    //      * the security mode
    //      * @default MessageSecurityMode.None
    //      */
    //     securityMode?: MessageSecurityMode | string;
    //     /**
    //      * the security policy
    //      * @default SecurityPolicy.None
    //      */
    //     securityPolicy?: SecurityPolicy | string;
    //     /**
    //      * @default false
    //      */
    //     keepSessionAlive?: boolean;
    //     /**
    //      * client certificate pem file.
    //      * @default "certificates/client_self-signed_cert_2048.pem"
    //      */
    //     certificateFile?: string;
    //     /**
    //      * client private key pem file.
    //      * @default "certificates/client_key_2048.pem"
    //      */
    //     privateKeyFile?: string;
    //     /**
    //      * a client name string that will be used to generate session names.
    //      */
    //     clientName?: string;

    clientName: `opcua-machinery-client-${new Date().valueOf()}`,
    endpointMustExist: false,

    requestedSessionTimeout: config.requestTimeoutMs,
    keepSessionAlive: true,
    keepPendingSessionsOnDisconnect: false,

    connectionStrategy: {
        initialDelay: 1000,
        maxDelay: 5000,
        maxRetry: 100
    },
};

const createSubscriptionRequest: CreateSubscriptionRequestOptions = {
    // export interface CreateSubscriptionRequestOptions {
    //     requestHeader?: RequestHeaderOptions;
    //     requestedPublishingInterval?: Double;
    //     requestedLifetimeCount?: UInt32;
    //     requestedMaxKeepAliveCount?: UInt32;
    //     maxNotificationsPerPublish?: UInt32;
    //     publishingEnabled?: UABoolean;
    //     priority?: Byte;
    // }
    requestedPublishingInterval: config.publishingIntervalMs,
    maxNotificationsPerPublish: 10000,
    publishingEnabled: true,
    // priority: 1,
}

/*
 * ModelChangeStructureDataType verb (OPC 10000-5 12.16 Table 254): an 8-bit unsigned integer used as
 * bit mask. These are the real bit positions - the old code's 0x01/0x10/0x100/0x1000 pattern shifted a
 * decimal '1' per verb and used a mask beyond the 8-bit range, so only NodeAdded ever matched.
 */
const MODEL_CHANGE_VERB = {
    nodeAdded: 0x01,
    nodeDeleted: 0x02,
    referenceAdded: 0x04,
    referenceDeleted: 0x08,
    dataTypeChanged: 0x10,
}

export class OpcUaDeviceProxyClass {

    readonly endpoint: string
    readonly client: OPCUAClient
    readonly userIdentityInfo: UserIdentityInfo

    private session: ClientSession | undefined
    private subscription: ClientSubscription | undefined

    private monitoredItemValueMap: Map<string, ClientMonitoredItem> = new Map()
    private namespaceArray: string[] = []
    private typeResolver: UaTypeResolver | undefined
    private serverProfileArray: string[] = []
    private serverState: number = ServerState.Unknown
    private serverStatus: ServerStatusDataType | null = null
    private serviceLevel: number = 0
    private deviceLimits: Map<string, any> = new Map()
    private foundMachines: Set<string> = new Set<string>()
    private machines: Map<string, UaMachineryMachine> = new Map()
    private _summery: object = Object.create({})
    private _reinitializing: boolean = false
    private _relatedNodeIdMap: Map<string, UaMachineryMachine | UaMachineryComponent | UaProcessValue> = new Map()
    /* owning Machine per related NodeId - model changes re-discover a whole Machine, not one model */
    private _owningMachineByNodeId: Map<string, UaMachineryMachine> = new Map()
    private _relatedVariableNodeIds: Set<string> = new Set<string>()
    private _initialized: boolean = false
    private _queuedBaseModelChangeEvents: Variant[][] = []
    private _queuedGeneralModelChangeEvents: Variant[][] = []
    private _queuedSemanticChangeEvents: Variant[][] = []
    private _drainingChangeEvents: boolean = false
    private _rescanRunning: boolean = false
    private _rescanDueTimer: NodeJS.Timeout | undefined
    /* NodeId of the Machinery Machines folder, known after the first findMachinesOnServer() */
    private _machinesFolderNodeId: string | null = null
    private findMachinesOnServerInterval: NodeJS.Timeout | undefined
    private updateSummeryInterval: NodeJS.Timeout | undefined

    constructor (endpoint: string, userIdentityInfo: UserIdentityInfo) {
        this.endpoint = endpoint
        this.userIdentityInfo = userIdentityInfo
        this.client = OPCUAClient.create(optionsInitial)
        this.client.on("backoff", (retry: number, delay: number) => {
            console.warn(`OPC UA Client: unable to connect to the OPC UA Device @ '${endpoint}' - attempt '${retry}' retrying in '${delay / 1000.0}' seconds`)
        });
        this.client.on("connected", () => {
            console.log(`OPC UA Client: connected to OPC UA Device @ '${endpoint}'`)
        })
        this.client.on("after_reconnection", async () => {
            console.log(`OPC UA Client: reconnected to OPC UA Device @ '${endpoint}'`)
        })
        this.client.on("reconnection_attempt_has_failed", (err: Error, message: string) => {
            console.error(`OPC UA Client: reconnect attemp has failed! err='${err}' message='${message}'`)
        })
        this.client.on("abort", () => {
            console.error(`OPC UA Client: abort!`)
        })
        this.client.on("close", () => {
            console.error(`OPC UA Client: close!`)
        })
        this.client.on("connection_failed", (err: Error) => {
            console.error(`OPC UA Client: connection has failed! err='${err}'`)
        })
        this.client.on("connection_lost", () => {
            console.warn(`OPC UA Client: connection lost!`)
        })
        this.client.on("connection_reestablished", () => {
            console.log(`OPC UA Client: connection reestablished!`)
        })
        this.client.on("lifetime_75", (token: ChannelSecurityToken) => {
            console.log(`OPC UA Client: securechannel token lifetime @ 75%! tokenId='${token.tokenId}'`)
        })
        this.client.on("receive_chunk", () => {
            // too noisy
        })
        this.client.on("receive_response", () => {
            // too noisy
            // console.log(`OPC UA Client: response='${response}'`)
        })
        this.client.on("security_token_renewed", () => {
            console.log(`OPC UA Client: security token renewed!`)
        })
        this.client.on("send_chunk", () => {
            // too noisy
        })
        this.client.on("send_request", () => {
            // too noisy
            // console.log(`OPC UA Client: request='${request}'`)
        })
        this.client.on("start_reconnection", () => {
            console.log(`OPC UA Client: start reconnection!`)
        })
        this.client.on("timed_out_request", (request: any) => {
            console.warn(`OPC UA Client: request timed out! request='${request}'`)
        })
    }

    get reinitializing() {
        return this._reinitializing
    }

    get summery() {
        return this._summery
    }

    private isConnected(): boolean {
        return this.client.isReconnecting === false ? true : false
    }

    private isSessionPresent(): boolean {
        if (this.session !== undefined) {
            return this.session!.isReconnecting === false ? true : false
        } else {
            return false
        }
    }

    private async createSession(userIdentityInfo: UserIdentityInfo | undefined) {
        this.session = await this.client.createSession2(userIdentityInfo)
        this.session.on("session_closed", (statusCode: StatusCode) => {
            console.error(`OPC UA Client: session closed! statusCode='${statusCode.toString()}'`)
        })
        this.session.on("keepalive", (lastKnownServerState: ServerState) => {
            console.log(`OPC UA Client: session keepalive! lastKnownServerState='${lastKnownServerState.toString()}'`)
        })
        this.session.on("session_restored", () => {
            console.log(`OPC UA Client: session restored!`)
        })
        this.session.on("keepalive_failure", (state: any) => {
            console.log(`OPC UA Client: session keepalive failure! state='${state}'`)
        })
    }

    private async createSubscription() {
        this.subscription = await this.session!.createSubscription2(createSubscriptionRequest)
        console.log(`OPC UA Client: subscription created maxKeepAliveCount='${this.subscription.maxKeepAliveCount}' lifetimeCount='${this.subscription.lifetimeCount}'`)
        this.subscription.on("status_changed", (status: StatusCode, diagnosticInfo: DiagnosticInfo) => {
            console.log(`OPC UA Client: subscription status_changed! status='${status}' diagnosticInfo='${diagnosticInfo}'`)
        })
        this.subscription.on("terminated", () => {
            console.warn(`OPC UA Client: subscription terminated!`)
        })
        this.subscription.on("keepalive", () => {
            console.log(`OPC UA Client: subscription keepalive!`)
        })
        this.subscription.on("error", (err: Error) => {
            console.error(`OPC UA Client: subscription error! err='${err}'`)
        })
        this.subscription.on("internal_error", (err: Error) => {
            console.error(`OPC UA Client: subscription internal_error! err='${err}'`)
        })
        this.subscription.on("started", (subscriptionId: number) => {
            console.log(`OPC UA Client: subscription started! subscriptionId='${subscriptionId}'`)
        })
        this.subscription.on("received_notifications", (notificationMessage: NotificationMessage) => {
            // console.log(`OPC UA Client: subscription got notification message! notificationMessage='${JSON.stringify(notificationMessage)}'`)
        })
        this.subscription.on("item_added", (monitoredItem: ClientMonitoredItem) => {
            // console.log(`OPC UA Client: monitoredItem with nodeId='${monitoredItem.itemToMonitor.nodeId}' has been added to the Subscription!`)
            if (monitoredItem.itemToMonitor.attributeId.valueOf() !== AttributeIds.Value) return
            const monitoredNodeId = monitoredItem.itemToMonitor.nodeId.toString()
            this.monitoredItemValueMap.set(monitoredNodeId, monitoredItem)
            monitoredItem.on("terminated", () => {
                /* server-side or explicit terminate - keep the map in sync so syncMonitoredItems() can re-monitor */
                this.monitoredItemValueMap.delete(monitoredNodeId)
            })
            monitoredItem.on("changed", (dataValue: DataValue) => {
                const nodeId = monitoredItem.itemToMonitor.nodeId.toString()
                switch (nodeId) {
                    case "ns=0;i=2256":
                    case "i=2256":
                        this.serverStatus = dataValue.value.value
                        return
                    case "ns=0;i=2267":
                    case "i=2267":
                        this.serviceLevel = dataValue.value.value
                        return
                }
                /*
                 * O(1) routing through _relatedNodeIdMap instead of asking every machine: the map keys
                 * every model NodeId to its owning model (machine / component / processValue), so a
                 * DataChange reaches exactly one model. Machine-level ids land on the machine, whose
                 * notify() fans out to its own blocks / ProcessValues / jobs / components.
                 */
                const item = this._relatedNodeIdMap.get(nodeId)
                if (item === undefined) {
                    log.debug(`OPC UA Client: DataChange for NodeId='${nodeId}' has no owning model in _relatedNodeIdMap - ignored`)
                    return
                }
                item.notify(nodeId, dataValue)
            })
        })
        console.log(`OPC UA Client: add ServerState and ServiceLevel to Subscription!`)
        this.subscription.monitorItems([
                {
                    nodeId: "i=2256",
                    attributeId: AttributeIds.Value
                },
                {
                    nodeId: "i=2267",
                    attributeId: AttributeIds.Value
                }
            ],
            {
                samplingInterval: config.serverSamplingIntervalMs,
                queueSize: 1
            },
            TimestampsToReturn.Both
        )
    }

    async initialize() {
        await this.client.connect(this.endpoint)
        await this.createSession(this.userIdentityInfo)
        await this.readServerState()
        if (this.serverState > 0) {
            console.error(`OPC UA Client: OPC UA Device @ '${this.endpoint}' has invalid ServerState '${this.serverState}'`)
            await this.client.disconnect()
            console.warn(`OPC UA Client: next attempt to connect to OPC UA Device @ '${this.endpoint}' in 10s`)
            setTimeout(async () => {
                await this.initialize()
            }, config.initRetryDelayMs)
            return
        }
        await this.readServiceLevel()
        if (this.serviceLevel <= 200) {
            console.error(`OPC UA Client: OPC UA Device @ '${this.endpoint}' has insufficient ServiceLevel '${this.serviceLevel}'`)
            await this.client.disconnect()
            console.warn(`OPC UA Client: next attempt to connect to OPC UA Device @ '${this.endpoint}' in 10s`)
            setTimeout(async () => {
                await this.initialize()
            }, config.initRetryDelayMs)
            return
        }
        await this.readServerStatus()
        await this.readNameSpaceArray()
        /*
         * The type resolver needs the namespace array to turn spec TypeRefs into real server NodeIds,
         * so it is created after the NamespaceArray read and lives as long as the session does.
         */
        this.typeResolver = new UaTypeResolver(this.session!, this.namespaceArray)
        await this.readServerProfileArray()
        await this.readDeviceLimits()
        this.updateSummery()
        await this.createSubscription()
        await this.setupChangeEvents()
        await this.findMachinesOnServer()
        await this.discoverFoundMachines()
        this.collectRelatedNodeIds()
        this.collectRelatedVariableNodeIds()
        await this.subscribeRelatedVariableNodeIds()
        this._initialized = true
        if (
            this._queuedBaseModelChangeEvents.length > 0 ||
            this._queuedGeneralModelChangeEvents.length > 0 ||
            this._queuedSemanticChangeEvents.length > 0
        ) {
            await this.drainChangeEvents()
        }
        this.findMachinesOnServerInterval = setInterval(async () => {
            if (this.isConnected() === false) return
            if (this.isSessionPresent() === false) return
            await this.runRescan()
        }, config.rescanIntervalMs)
    }

    private updateSummery() {
        Object.assign(this._summery, {
            Server: {
                Endpoint: this.endpoint,
                ServerState: this.serverState,
                ServiceLevel: this.serviceLevel,
                ServerStatus: {
                    StartTime: this.serverStatus?.startTime || null,
                    CurrentTime: this.serverStatus?.currentTime || null,
                    State: this.serverStatus?.state || null,
                    BuildInfo: {
                        ProductUri: this.serverStatus?.buildInfo.productUri || null,
                        ManufacturerName: this.serverStatus?.buildInfo.manufacturerName || null,
                        ProductName: this.serverStatus?.buildInfo.productName || null,
                        SoftwareVersion: this.serverStatus?.buildInfo.softwareVersion || null,
                        BuildNumber: this.serverStatus?.buildInfo.buildNumber || null,
                        BuildDate: this.serverStatus?.buildInfo.buildDate || null
                    },
                    SecondsTillShutdown: this.serverStatus?.secondsTillShutdown || null,
                    ShutdownReason: `${this.serverStatus?.shutdownReason.text}` || null
                },
                NamespaceArray: this.namespaceArray,
                ServerProfileArray: this.serverProfileArray,
                OperationalLimits: Object.fromEntries(this.deviceLimits.entries())
            },
            Machines: Array.from(this.machines.values()).map((item) => {return item.toJSON()})
        })
    }

    private collectRelatedNodeIds() {
        this._relatedNodeIdMap.clear()
        this._owningMachineByNodeId.clear()
        const machines = Array.from(this.machines.values())
        for (let index = 0; index < machines.length; index++) {
            const machine = machines[index] as UaMachineryMachine
            machine._relatedNodeIds.forEach((nodeId) => {
                this._relatedNodeIdMap.set(nodeId, machine)
                this._owningMachineByNodeId.set(nodeId, machine)
            })
            this.forEachMachineComponent(machine, (component) => {
                component._relatedNodeIds.forEach((nodeId) => {
                    this._relatedNodeIdMap.set(nodeId, component)
                    this._owningMachineByNodeId.set(nodeId, machine)
                })
            })
            const processValues: UaProcessValue[] = Array.from(machine.monitoring.values())
            for (let index = 0; index < processValues.length; index++) {
                const processValue = processValues[index];
                processValue._relatedNodeIds.forEach((nodeId) => {
                    this._relatedNodeIdMap.set(nodeId, processValue)
                    this._owningMachineByNodeId.set(nodeId, machine)
                })
            }
        }

        const relatedNodes = Array.from(this._relatedNodeIdMap.keys())
        console.log(`OPC UA Client: contains '${relatedNodes.length}' related NodeId's`)
    }

    /*
     * Components are a tree (ua-machine-component.ts browses nested Components AddIns), so both
     * collection walks have to descend into it.
     */
    private forEachMachineComponent(machine: UaMachineryMachine, visit: (component: UaMachineryComponent) => void) {
        const walk = (component: UaMachineryComponent) => {
            visit(component)
            for (const nested of component.components.values()) {
                walk(nested)
            }
        }
        for (const component of machine.components.values()) {
            walk(component)
        }
    }

    private collectRelatedVariableNodeIds() {
        this._relatedVariableNodeIds.clear()
        const machines = Array.from(this.machines.values())
        for (let index = 0; index < machines.length; index++) {
            const machine = machines[index] as UaMachineryMachine
            machine._relatedVariableNodeIds.forEach((nodeId) => {
                this._relatedVariableNodeIds.add(nodeId)
            })
            /* only Variables/Properties may be monitored: _relatedNodeIds also holds Object and
               ObjectType NodeIds (AddIns, TypeDefinitions), which a subscription must not take */
            this.forEachMachineComponent(machine, (component) => {
                component._relatedVariableNodeIds.forEach((nodeId) => {
                    this._relatedVariableNodeIds.add(nodeId)
                })
            })
            const processValues: UaProcessValue[] = Array.from(machine.monitoring.values())
            for (let index = 0; index < processValues.length; index++) {
                const processValue = processValues[index];
                processValue._relatedVariableNodeIds.forEach((nodeId) => {
                    this._relatedVariableNodeIds.add(nodeId)
                })
            }
        }
        console.log(`OPC UA Client: contains '${this._relatedVariableNodeIds.size}' related Variable/Property-NodeId's`)
    }

    /*
     * monitorItems() rejects an empty node list with BadNothingToDo (0x800f0000), and a server answers
     * BadTooManyMonitoredItems once one request exceeds MaxMonitoredItemsPerCall. Hence: an empty set
     * subscribes nothing, everything else goes in chunks that stay below the server limits.
     */
    private async subscribeRelatedVariableNodeIds() {
        const nodeIds = Array.from(this._relatedVariableNodeIds.values())
        if (nodeIds.length === 0) {
            console.warn(`OPC UA Client: no Variable/Property to add to Subscription! the server exposes no monitored node`)
            this.logMonitoredItemCount('after initial subscription')
            return
        }
        const maxPerSub = this.deviceLimits.get("MaxMonitoredItemsPerSubscription") || 0
        if (maxPerSub > 0 && nodeIds.length > (maxPerSub - config.subscriptionSlack)) {
            const allowed = Math.max(1, maxPerSub - config.subscriptionSlack)
            console.warn(`OPC UA Client: '${nodeIds.length}' Variables/Properties exceed MaxMonitoredItemsPerSubscription '${maxPerSub}', monitoring only '${allowed}'!`)
            nodeIds.length = allowed
        }
        const chunkSize = this.chunkSizeFor(nodeIds.length)
        console.log(`OPC UA Client: adding '${nodeIds.length}' related Variables and Properties to Subscription in chunks of '${chunkSize}'!`)
        await this.monitorRelatedVariablesChunked(nodeIds)
        this.logMonitoredItemCount('after initial subscription')
    }

    /*
     * ChangeEvents that arrive before initialization finished are queued; after init they are drained
     * in a single serialized drain loop (events that arrive *during* processing are queued by the
     * handlers and picked up by the running drain).
     */
    private async drainChangeEvents() {
        if (this._drainingChangeEvents === true) return
        this._drainingChangeEvents = true
        try {
            while (
                this._queuedBaseModelChangeEvents.length > 0 ||
                this._queuedGeneralModelChangeEvents.length > 0 ||
                this._queuedSemanticChangeEvents.length > 0
            ) {
                console.log(`OPC UA Client: draining queued ChangeEvents [Base=${this._queuedBaseModelChangeEvents.length},General=${this._queuedGeneralModelChangeEvents.length},Semantic=${this._queuedSemanticChangeEvents.length}]`)
                try {
                    if (this._queuedBaseModelChangeEvents.length > 0) {
                        /*
                         * BaseModelChangeEventType carries no detail about what changed (OPC 10000-3 9.32.5),
                         * so the only safe reaction is a debounced address-space re-scan.
                         */
                        this._queuedBaseModelChangeEvents = []
                        this.scheduleModelRescan()
                    }
                    if (this._queuedGeneralModelChangeEvents.length > 0) {
                        const batch = this._queuedGeneralModelChangeEvents
                        this._queuedGeneralModelChangeEvents = []
                        for (let index = 0; index < batch.length; index++) {
                            await this.processGeneralModelChangeEvent(batch[index])
                        }
                    }
                    if (this._queuedSemanticChangeEvents.length > 0) {
                        const batch = this._queuedSemanticChangeEvents
                        this._queuedSemanticChangeEvents = []
                        for (let index = 0; index < batch.length; index++) {
                            await this.processSemanticChangeEvent(batch[index])
                        }
                    }
                } catch (error) {
                    /* an unhandled rejection here would kill the process (main.ts exit handler) */
                    console.error(`OPC UA Client: change event processing failed: ${(error as Error).stack ?? error}`)
                }
            }
        } finally {
            this._drainingChangeEvents = false
        }
    }

    private clearAllIntervals() {
        if (this.updateSummeryInterval !== undefined) clearInterval(this.updateSummeryInterval)
        if (this.findMachinesOnServerInterval !== undefined) clearInterval(this.findMachinesOnServerInterval!)
        if (this._rescanDueTimer !== undefined) {
            clearTimeout(this._rescanDueTimer)
            this._rescanDueTimer = undefined
        }
    }

    async disconnect() {
        console.log(`OPC UA Client: terminating Subscription!`)
        await this.subscription?.terminate()
        console.log(`OPC UA Client: closing Session!`)
        await this.session?.close()
        console.log(`OPC UA Client: diconnecting!`)
        await this.client.disconnect()
        this.clearAllIntervals()
    }

    async reinitialize() {
        console.warn("OPC UA Client: reinitializing")
        this._reinitializing = true
        await this.disconnect()
        await this.initialize()
        console.warn("OPC UA Client: reinitializing completed!")
        this._reinitializing = false
    }

    private async setupChangeEvents() {
        const baseModelChangeEventMonitoredItem: ClientMonitoredItem = ClientMonitoredItem.create(
            this.subscription!,
            {
                attributeId: AttributeIds.EventNotifier,
                nodeId: ObjectIds.Server
            },
            {
                discardOldest: true,
                filter: constructEventFilter([
                    "EventId",
                    "EventType",
                    "SourceNode",
                    "SourceName",
                    "Time",
                    "ReceiveTime",
                    "Message",
                    "Severity"
                ], ofType("BaseModelChangeEventType")),
                queueSize: 100000
            },
            TimestampsToReturn.Both
        )
        baseModelChangeEventMonitoredItem.on("changed", async (values: Variant[]) => {
            // https://reference.opcfoundation.org/Core/Part3/9.32.7/
            console.warn(`OPC UA Client: BaseModelChangeEvent received!`)
            this._queuedBaseModelChangeEvents.push(values)
            if (this._initialized === true) {
                await this.drainChangeEvents()
            }
        })
        const generalModelChangeEventMonitoredItem: ClientMonitoredItem = ClientMonitoredItem.create(
            this.subscription!,
            {
                attributeId: AttributeIds.EventNotifier,
                nodeId: ObjectIds.Server
            },
            {
                discardOldest: true,
                filter: constructEventFilter([
                    "Changes"
                ], ofType("GeneralModelChangeEventType")),
                queueSize: 100000
            },
            TimestampsToReturn.Both
        )
        generalModelChangeEventMonitoredItem.on("changed", async (values: Variant[]) => {
            // https://reference.opcfoundation.org/Core/Part3/9.32.7/
            console.warn(`OPC UA Client: GeneralModelChangeEvent received!`)
            this._queuedGeneralModelChangeEvents.push(values)
            if (this._initialized === true) {
                await this.drainChangeEvents()
            }
        })
        const semanticChangeEventMonitoredItem: ClientMonitoredItem = ClientMonitoredItem.create(
            this.subscription!,
            {
                attributeId: AttributeIds.EventNotifier,
                nodeId: ObjectIds.Server
            },
            {
                discardOldest: true,
                filter: constructEventFilter([
                    "Changes"
                ], ofType("SemanticChangeEventType")),
                queueSize: 100000
            },
            TimestampsToReturn.Both
        )
        semanticChangeEventMonitoredItem.on("changed", async (values: Variant[]) => {
            // https://reference.opcfoundation.org/Core/Part3/v104/docs/9.33
            console.warn(`OPC UA Client: SemanticChangeEventType received!`)
            this._queuedSemanticChangeEvents.push(values)
            if (this._initialized === true) {
                await this.drainChangeEvents()
            }
        })
    }

    /*
     * GeneralModelChangeEventType - 'Changes' is a ModelChangeStructureDataType[]
     * (OPC 10000-5 12.16 Table 254: affected, affectedType, verb bitmask).
     * Reaction per verb:
     * - NodeDeleted / ReferenceDeleted: a deleted Machine is dropped from the model together with its
     *   monitored items; a deleted node below a Machine re-triggers that Machine's discovery, and the
     *   stale monitored items are terminated afterwards via syncMonitoredItems().
     * - NodeAdded / ReferenceAdded: only the affected NodeId is known (there is no parent field), so an
     *   unknown node schedules a debounced address-space re-scan; a known node re-discovers its Machine.
     * - DataTypeChanged: the Variable's shape changed - re-discover the owning Machine.
     */
    private async processGeneralModelChangeEvent(values: Variant[]) {
        const machinesToReinitialize = new Set<string>()
        const machinesToRemove = new Set<string>()
        let rescanRequested = false
        for (let index = 0; index < values.length; index++) {
            const variant = values[index];
            if (Array.isArray(variant.value) === false) continue
            const changes = variant.value
            for (let index = 0; index < changes.length; index++) {
                const change = changes[index];
                const affected = change.affected ?? change.AffectedNodeId
                if (affected === undefined || affected === null) continue
                const nodeId = affected.toString()
                const verb: number = Number(change.verb ?? 0)
                if ((verb & MODEL_CHANGE_VERB.nodeAdded) === MODEL_CHANGE_VERB.nodeAdded) {
                    console.warn(`OPC UA Client: NodeId='${nodeId}' has been added!`)
                    if (this._relatedNodeIdMap.has(nodeId) === false) rescanRequested = true
                }
                if ((verb & MODEL_CHANGE_VERB.nodeDeleted) === MODEL_CHANGE_VERB.nodeDeleted) {
                    console.warn(`OPC UA Client: NodeId='${nodeId}' has been deleted!`)
                    if (this.machines.has(nodeId)) machinesToRemove.add(nodeId)
                    else {
                        const owner = this._owningMachineByNodeId.get(nodeId)
                        if (owner !== undefined) machinesToReinitialize.add(owner.nodeId)
                        else log.debug(`OPC UA Client: deleted NodeId='${nodeId}' is not part of the model - nothing to do`)
                    }
                }
                if ((verb & MODEL_CHANGE_VERB.referenceAdded) === MODEL_CHANGE_VERB.referenceAdded) {
                    console.warn(`OPC UA Client: NodeId='${nodeId}' a Reference has been added!`)
                    const owner = this._owningMachineByNodeId.get(nodeId)
                    if (owner !== undefined) machinesToReinitialize.add(owner.nodeId)
                    else rescanRequested = true
                }
                if ((verb & MODEL_CHANGE_VERB.referenceDeleted) === MODEL_CHANGE_VERB.referenceDeleted) {
                    console.warn(`OPC UA Client: NodeId='${nodeId}' a Reference has been deleted!`)
                    /* the Machine lost its Organizes/HasComponent parent -> it is gone for this client */
                    if (this.machines.has(nodeId)) machinesToRemove.add(nodeId)
                    else {
                        const owner = this._owningMachineByNodeId.get(nodeId)
                        if (owner !== undefined) machinesToReinitialize.add(owner.nodeId)
                        else log.debug(`OPC UA Client: reference-deleted NodeId='${nodeId}' is not part of the model - nothing to do`)
                    }
                }
                if ((verb & MODEL_CHANGE_VERB.dataTypeChanged) === MODEL_CHANGE_VERB.dataTypeChanged) {
                    console.warn(`OPC UA Client: NodeId='${nodeId}' datatype has been changed!`)
                    const owner = this._owningMachineByNodeId.get(nodeId)
                    if (owner !== undefined) machinesToReinitialize.add(owner.nodeId)
                }
            }
        }
        for (const nodeId of Array.from(machinesToRemove)) {
            await this.removeMachine(nodeId, 'GeneralModelChangeEvent NodeDeleted/ReferenceDeleted')
        }
        for (const nodeId of Array.from(machinesToReinitialize)) {
            if (machinesToRemove.has(nodeId)) continue
            await this.reinitializeMachine(nodeId, 'GeneralModelChangeEvent')
        }
        if (machinesToRemove.size > 0 || machinesToReinitialize.size > 0) {
            this.collectRelatedNodeIds()
            this.collectRelatedVariableNodeIds()
            await this.syncMonitoredItems()
            this.updateSummery()
            this.logBuildingBlockSummary()
        }
        if (rescanRequested === true) {
            this.scheduleModelRescan()
        }
    }

    /*
     * SemanticChangeEventType - 'Changes' is a SemanticChangeStructureDataType[]
     * (OPC 10000-5: semanticChangeId / sourceNode / clientId). The semantic definition of a source node
     * changed without the node itself changing, so re-browse the owning Machine; an unknown SourceNode
     * schedules a debounced address-space re-scan.
     */
    private async processSemanticChangeEvent(values: Variant[]) {
        const machinesToReinitialize = new Set<string>()
        let rescanRequested = false
        for (let index = 0; index < values.length; index++) {
            const variant = values[index];
            if (Array.isArray(variant.value) === false) continue
            const changes = variant.value
            for (let index = 0; index < changes.length; index++) {
                const change = changes[index];
                const sourceNode = change.sourceNode ?? change.SourceNode
                if (sourceNode === undefined || sourceNode === null) {
                    rescanRequested = true
                    continue
                }
                const nodeId = sourceNode.toString()
                const owner = this._owningMachineByNodeId.get(nodeId)
                if (owner !== undefined) machinesToReinitialize.add(owner.nodeId)
                else rescanRequested = true
            }
        }
        for (const nodeId of Array.from(machinesToReinitialize)) {
            await this.reinitializeMachine(nodeId, 'SemanticChangeEvent')
        }
        if (machinesToReinitialize.size > 0) {
            this.collectRelatedNodeIds()
            this.collectRelatedVariableNodeIds()
            await this.syncMonitoredItems()
            this.updateSummery()
        }
        if (rescanRequested === true) {
            this.scheduleModelRescan()
        }
    }

    /*
     * Drop a Machine from the model: terminate its monitored items, remove it from foundMachines /
     * machines so the re-scan does not re-add a node the server has deleted.
     */
    private async removeMachine(machineNodeId: string, reason: string) {
        const machine = this.machines.get(machineNodeId)
        if (machine === undefined) return
        const ownedVariableNodeIds = new Set<string>()
        machine._relatedVariableNodeIds.forEach((nodeId) => ownedVariableNodeIds.add(nodeId))
        this.forEachMachineComponent(machine, (component) => {
            component._relatedVariableNodeIds.forEach((nodeId) => ownedVariableNodeIds.add(nodeId))
        })
        for (const processValue of machine.monitoring.values()) {
            processValue._relatedVariableNodeIds.forEach((nodeId) => ownedVariableNodeIds.add(nodeId))
        }
        for (const nodeId of Array.from(ownedVariableNodeIds)) {
            await this.terminateMonitoredItem(nodeId)
        }
        this.machines.delete(machineNodeId)
        this.foundMachines.delete(machineNodeId)
        console.warn(`OPC UA Client: Machine '${machineNodeId}' removed from the model (${reason}) - terminated '${ownedVariableNodeIds.size}' monitored items`)
    }

    /*
     * Re-run the full discovery of one Machine. A fresh UaMachineryMachine is built (models must not be
     * re-initialized in place - their member maps are not cleared, so re-initializing would merge stale
     * and fresh entries). If the node is gone the discovery fails and the Machine is removed instead.
     */
    private async reinitializeMachine(machineNodeId: string, reason: string) {
        console.log(`OPC UA Client: re-discovering Machine '${machineNodeId}' (${reason})`)
        const succeeded = await this.discoverSingleMachine(machineNodeId)
        if (succeeded === false) {
            await this.removeMachine(machineNodeId, `${reason} - re-discovery failed, node is likely deleted`)
        }
    }

    private async terminateMonitoredItem(nodeId: string) {
        const monitoredItem = this.monitoredItemValueMap.get(nodeId)
        if (monitoredItem === undefined) return
        this.monitoredItemValueMap.delete(nodeId)
        try {
            await monitoredItem.terminate()
        } catch (error) {
            log.warn(`OPC UA Client: terminating monitored item for NodeId='${nodeId}' failed: ${(error as Error).message}`)
        }
    }

    /*
     * Bring the subscription in sync with _relatedVariableNodeIds: terminate monitored items whose
     * Variable left the model and monitor newly appeared Variables, staying below
     * MaxMonitoredItemsPerSubscription (minus slack) / MaxMonitoredItemsPerCall.
     */
    private async syncMonitoredItems() {
        if (this.subscription === undefined) return
        let terminatedCount = 0
        for (const nodeId of Array.from(this.monitoredItemValueMap.keys())) {
            if (nodeId === "ns=0;i=2256" || nodeId === "i=2256" || nodeId === "ns=0;i=2267" || nodeId === "i=2267") continue
            if (this._relatedVariableNodeIds.has(nodeId) === false) {
                await this.terminateMonitoredItem(nodeId)
                terminatedCount++
            }
        }
        const additions = Array.from(this._relatedVariableNodeIds).filter((nodeId) => this.monitoredItemValueMap.has(nodeId) === false)
        if (additions.length > 0) {
            const maxPerSub = this.deviceLimits.get("MaxMonitoredItemsPerSubscription") || 0
            if (maxPerSub > 0) {
                const capacity = maxPerSub - config.subscriptionSlack - this.monitoredItemValueMap.size
                if (additions.length > capacity) {
                    console.warn(`OPC UA Client: '${additions.length}' new Variables exceed MaxMonitoredItemsPerSubscription '${maxPerSub}' (monitored items '${this.monitoredItemValueMap.size}', slack '${config.subscriptionSlack}'), monitoring only '${Math.max(0, capacity)}'!`)
                    additions.length = Math.max(0, capacity)
                }
            }
            await this.monitorRelatedVariablesChunked(additions)
        }
        if (terminatedCount > 0 || additions.length > 0) {
            console.log(`OPC UA Client: monitored items synced [terminated='${terminatedCount}', added='${additions.length}']`)
            this.logMonitoredItemCount('after model change')
        }
    }

    /* Chunk size for monitorItems() requests: config cap, but always below MaxMonitoredItemsPerCall. */
    private chunkSizeFor(nodeIdsLength: number): number {
        let chunkSize = config.maxMonitoredItemsPerRequest > 0 ? config.maxMonitoredItemsPerRequest : nodeIdsLength
        const maxPerCall = this.deviceLimits.get("MaxMonitoredItemsPerCall") || 0
        if (maxPerCall > 0) {
            chunkSize = Math.min(chunkSize, Math.max(1, maxPerCall - config.subscriptionSlack))
        }
        return Math.max(1, Math.min(chunkSize, nodeIdsLength))
    }

    private async monitorRelatedVariablesChunked(nodeIds: string[]) {
        if (this.subscription === undefined || nodeIds.length === 0) return
        const chunkSize = this.chunkSizeFor(nodeIds.length)
        for (let start = 0; start < nodeIds.length; start += chunkSize) {
            const chunk = nodeIds.slice(start, start + chunkSize)
            try {
                const group = await this.subscription.monitorItems(
                    chunk.map((id) => {
                        return {
                            nodeId: id,
                            attributeId: AttributeIds.Value,
                        } as ReadValueIdOptions
                    }),
                    {
                        samplingInterval: config.samplingIntervalMs,
                        queueSize: 1000
                    },
                    TimestampsToReturn.Both
                )
                log.debug(`OPC UA Client: monitored-item chunk '${Math.floor(start / chunkSize) + 1}' of '${Math.ceil(nodeIds.length / chunkSize)}' created '${group.monitoredItems.length}' items`)
            } catch (error) {
                /* keep the drain/rescan alive - unmonitored ids are retried by the next syncMonitoredItems() */
                console.error(`OPC UA Client: monitorItems chunk failed: ${(error as Error).message}`)
            }
        }
    }

    private logMonitoredItemCount(context: string) {
        const count = this.monitoredItemValueMap.size
        const maxPerSub = this.deviceLimits.get("MaxMonitoredItemsPerSubscription") || 0
        const limitText = maxPerSub > 0 ? ` / MaxMonitoredItemsPerSubscription '${maxPerSub}'` : ''
        console.log(`OPC UA Client: monitored items '${count}'${limitText} (${context})`)
    }

    /* Debounced address-space re-scan triggered by model change events. */
    private scheduleModelRescan() {
        if (this._rescanDueTimer !== undefined) return
        console.warn(`OPC UA Client: model change detected - scheduled re-scan in '${config.modelChangeRescanDebounceMs / 1000}' seconds`)
        this._rescanDueTimer = setTimeout(() => {
            this._rescanDueTimer = undefined
            this.runRescan().catch((error) => console.error(`OPC UA Client: scheduled re-scan failed: ${(error as Error).stack ?? error}`))
        }, config.modelChangeRescanDebounceMs)
    }

    /*
     * Address-space re-scan (also the RESCAN_INTERVAL_MS interval body): re-browse the Machines folder,
     * load Machines that appeared, keep the subscription in sync and refresh the summary. One run at a
     * time - a scheduled run that overlaps the interval is skipped.
     */
    private async runRescan() {
        if (this._rescanRunning === true) return
        this._rescanRunning = true
        try {
            await this.findMachinesOnServer()
            const foundMachines = Array.from(this.foundMachines)
            let newMachinesFound = false
            for (let index = 0; index < foundMachines.length; index++) {
                const machineId = foundMachines[index];
                if (this.machines.has(machineId) === false) {
                    await this.discoverSingleMachine(machineId)
                    newMachinesFound = true
                }
            }
            if (newMachinesFound === true) {
                this.collectRelatedNodeIds()
                this.collectRelatedVariableNodeIds()
                await this.syncMonitoredItems()
                this.logBuildingBlockSummary()
                this.updateSummery()
            }
        } catch (error) {
            console.error(`OPC UA Client: re-scan failed: ${(error as Error).stack ?? error}`)
        } finally {
            this._rescanRunning = false
        }
    }

    private async readServerState() {
        // i=2259 [Server_ServerStatus_State]
        const dv = await this.session!.read({
            nodeId: "i=2259",
            attributeId: AttributeIds.Value
        })
        if (isStatusCodeGoodish(dv.statusCode)) {
            this.serverState = dv.value.value
        }
        console.log(`OPC UA Client: read i=2259 [Server_ServerStatus_State] Value '${dv.value.value}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readServerStatus() {
        // i=2256 [Server_ServerStatus]
        const dv = await this.session!.read({
            nodeId: "i=2256",
            attributeId: AttributeIds.Value
        })
        if (isStatusCodeGoodish(dv.statusCode)) {
            this.serverStatus = dv.value.value
        }
        console.log(`OPC UA Client: read i=2256 [Server_ServerStatus] Value '${JSON.stringify(dv.value.value)}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readServiceLevel() {
        // i=2267 [Server_ServiceLevel]
        const dv = await this.session!.read({
            nodeId: "i=2267",
            attributeId: AttributeIds.Value
        })
        if (isStatusCodeGoodish(dv.statusCode)) {
            this.serviceLevel = dv.value.value
        }
        console.log(`OPC UA Client: read i=2267 [Server_ServiceLevel] Value '${dv.value.value}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readNameSpaceArray() {
        // i=2255 [Server_NamespaceArray]
        const dv = await this.session!.read({
            nodeId: "i=2255",
            attributeId: AttributeIds.Value
        })
        if (isStatusCodeGoodish(dv.statusCode)) {
            this.namespaceArray = dv.value.value
        }
        console.log(`OPC UA Client: read i=2255 [Server_NamespaceArray] Value '[${dv.value.value}]' StatusCode '${dv.statusCode.name}'`)
    }

    private async readDeviceLimits() {
        console.log(`OPC UA Client: reading DeviceLimits`)
        const readResults: DataValue[] = await this.session!.read([
            // MaxSubscriptionsPerSession -> i=24098
            {
                nodeId: "i=24098",
                attributeId: AttributeIds.Value
            },
            // MaxMonitoredItemsPerSubscription -> i=24104
            {
                nodeId: "i=24104",
                attributeId: AttributeIds.Value
            },
            // MaxMonitoredItemsPerCall -> i=11714
            {
                nodeId: "i=11714",
                attributeId: AttributeIds.Value
            },
            // MaxNodesPerMethodCall -> i=11709
            {
                nodeId: "i=11709",
                attributeId: AttributeIds.Value
            },
            // MaxNodesPerRead -> i=11705
            {
                nodeId: "i=11705",
                attributeId: AttributeIds.Value
            },
            // MaxNodesPerTranslateBrowsePathsToNodeIds -> i=11712
            {
                nodeId: "i=11712",
                attributeId: AttributeIds.Value
            },
            // MaxNodesPerWrite -> i=11707
            {
                nodeId: "i=11707",
                attributeId: AttributeIds.Value
            }
        ])

        if (isStatusCodeGoodish(readResults[0].statusCode)) this.deviceLimits.set("MaxSubscriptionsPerSession", readResults[0].value.value)
        if (isStatusCodeGoodish(readResults[1].statusCode)) this.deviceLimits.set("MaxMonitoredItemsPerSubscription", readResults[1].value.value)
        if (isStatusCodeGoodish(readResults[2].statusCode)) this.deviceLimits.set("MaxMonitoredItemsPerCall", readResults[2].value.value)
        if (isStatusCodeGoodish(readResults[3].statusCode)) this.deviceLimits.set("MaxNodesPerMethodCall", readResults[3].value.value)
        if (isStatusCodeGoodish(readResults[4].statusCode)) this.deviceLimits.set("MaxNodesPerRead", readResults[4].value.value)
        if (isStatusCodeGoodish(readResults[5].statusCode)) this.deviceLimits.set("MaxNodesPerTranslateBrowsePathsToNodeIds", readResults[5].value.value)
        if (isStatusCodeGoodish(readResults[6].statusCode)) this.deviceLimits.set("MaxNodesPerWrite", readResults[6].value.value)

        console.log(`OPC UA Client: UaDeviceLimits '${JSON.stringify(Object.fromEntries(this.deviceLimits.entries()), null, "\t")}'`)
    }

    private async readServerProfileArray() {
        // i=2269 [Server_ServerCapabilities_ServerProfileArray]
        const dv = await this.session!.read({
            nodeId: "i=2269",
            attributeId: AttributeIds.Value
        })
        if (isStatusCodeGoodish(dv.statusCode)) {
            this.serverProfileArray = dv.value.value
        }
        console.log(`OPC UA Client: read i=2269 [Server_ServerCapabilities_ServerProfileArray] Value '[${dv.value.value}]' StatusCode '${dv.statusCode.name}'`)
    }   

    private getNamespaceIndex(uri: string): number | undefined {
        const index = this.namespaceArray.indexOf(uri)
        return index === -1 ? undefined : index
    }

    private async discoverSingleMachine(id: string): Promise<boolean> {
        try {
            const uaMachine = new UaMachineryMachine(this.session!, id, this.namespaceArray, this.typeResolver!)
            await uaMachine.initialize()
            this.machines.set(`${id}`, uaMachine)
            return true
        } catch (error) {
            console.log(error)
            console.error(`OPC UA Client: '${id}' is not a valid Machine! ${error}`)
            return false
        }
    }

    private async discoverFoundMachines() {
        console.log(`OPC UA Client: start loading MetaData...`)
        const foundMachines = Array.from(this.foundMachines.values())
        for (let index = 0; index < foundMachines.length; index++) {
            const machineNodeId = foundMachines[index]
            console.log(`OPC UA Client: loading MetaData from Machine [${index + 1}/${foundMachines.length}] with id='${machineNodeId}'`)
            await this.discoverSingleMachine(machineNodeId)
        }
        console.log(`OPC UA Client: done loading MetaData!`)
        this.logBuildingBlockSummary()
        this.updateSummery()
        await writeJson(config.outputFile, this._summery, {spaces: '    '})
        this.updateSummeryInterval = setInterval(async () => {
            if (this.isConnected() === false) return
            if (this.isSessionPresent() === false) return
            this.updateSummery()
            await writeJson(config.outputFile, this._summery, {spaces: '    '})
            console.log(`OPC UA Client: '${config.outputFile}' got updated!`)
        }, config.refreshIntervalMs)
    }

    /*
     * Startup coverage lines: how many OPC 40001-1 building blocks and OPC 40001-3 JobManagement AddIns
     * were found across all machines.
     * 'foreign:<key>' counts candidates that carry a spec BrowseName but no spec TypeDefinition -
     * deviations of the server, not our coverage.
     */
    private logBuildingBlockSummary() {
        const totals = new Map<string, number>()
        for (const machine of this.machines.values()) {
            for (const [key, count] of machine.buildingBlockCounts().entries()) {
                totals.set(key, (totals.get(key) ?? 0) + count)
            }
        }
        const parts = Array.from(totals.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, count]) => `${key}=${count}`)
            .join(' ')
        console.log(`OPC UA Client: building blocks of '${this.machines.size}' machines: ${parts.length > 0 ? parts : 'none found'}`)
        const jobTotals = new Map<string, number>()
        for (const machine of this.machines.values()) {
            for (const [key, count] of machine.jobsCounts().entries()) {
                jobTotals.set(key, (jobTotals.get(key) ?? 0) + count)
            }
        }
        const jobParts = Array.from(jobTotals.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, count]) => `${key}=${count}`)
            .join(' ')
        console.log(`OPC UA Client: job management of '${this.machines.size}' machines: ${jobParts.length > 0 ? jobParts : 'none found - OPC 40001-3 not exposed by this server'}`)
    }

    private async findMachinesOnServer() {
        console.log(`OPC UA Client: findMachinesOnServer...`)
        const machineryIndex = this.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/")
        if (machineryIndex === undefined) return
        const machinesFolderNodeId = `ns=${machineryIndex};i=1001` // id is defined in spec. and can be hardcoded!
        this._machinesFolderNodeId = machinesFolderNodeId
        const browseResult = await this.session!.browse({
            nodeId: machinesFolderNodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.Organizes
        } as BrowseDescriptionLike)
        if (isStatusCodeGoodish(browseResult.statusCode)) {
            browseResult.references!.forEach((result) => {
                this.foundMachines.add(makeNodeIdStringFromExpandedNodeId(result.nodeId))
            })
            console.log(`OPC UA Client: found '${this.foundMachines.size}' machine instances!`)
        }
    }
}
