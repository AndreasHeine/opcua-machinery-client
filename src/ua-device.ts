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
    MonitoringMode,
} from 'node-opcua'
import { 
    isStatusCodeGoodish,
    makeNodeIdStringFromExpandedNodeId
} from './ua-helper';
import { writeJson } from 'fs-extra';
import { UaMachineryMachine } from './ua-machine';
import { UaMachineryComponent } from './ua-machine-component';
import { UaProcessValue } from './ua-processvalue';
import { clearInterval } from 'timers';

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

    requestedSessionTimeout: 30*60*1000,
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
    requestedPublishingInterval: 5000,
    maxNotificationsPerPublish: 10000,
    publishingEnabled: true,
    // priority: 1,
}

export class OpcUaDeviceProxyClass {

    readonly endpoint: string
    readonly client: OPCUAClient
    readonly userIdentityInfo: UserIdentityInfo

    private session: ClientSession | undefined
    private subscription: ClientSubscription | undefined

    private monitoredItemValueMap: Map<string, ClientMonitoredItem> = new Map()
    private namespaceArray: string[] = []
    private serverProfileArray: string[] = []
    private serverState: number = ServerState.Unknown
    private serverStatus: ServerStatusDataType | null = null
    private serviceLevel: number = 0
    private deviceLimits: Map<string, any> = new Map()
    private foundMachines: Set<string> = new Set<string>()
    private machines: Map<string, UaMachineryMachine> = new Map()
    private summery: object = Object.create({})
    private _reinitializing: boolean = false
    private _relatedNodeIdMap: Map<string, UaMachineryMachine | UaMachineryComponent | UaProcessValue> = new Map()
    private _relatedVariableNodeIds: Set<string> = new Set<string>()
    private _initialized: boolean = false
    private _queuedBaseModelChangeEvents: Variant[][] = []
    private _queuedGeneralModelChangeEvents: Variant[][] = []
    private _queuedSemanticChangeEvents: Variant[][] = []
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
        this.client.on("receive_response", (response: Response) => {
            // too noisy
            // console.log(`OPC UA Client: response='${response}'`)
        })
        this.client.on("security_token_renewed", () => {
            console.log(`OPC UA Client: security token renewed!`)
        })
        this.client.on("send_chunk", () => {
            // too noisy
        })
        this.client.on("send_request", (request: Request) => {
            // too noisy
            // console.log(`OPC UA Client: request='${request}'`)
        })
        this.client.on("start_reconnection", () => {
            console.log(`OPC UA Client: start reconnection!`)
        })
        this.client.on("timed_out_request", (request: Request) => {
            console.warn(`OPC UA Client: request timed out! request='${request}'`)
        })
    }

    get reinitializing() {
        return this._reinitializing
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
            this.monitoredItemValueMap.set(monitoredItem.itemToMonitor.nodeId.toString(), monitoredItem)
            monitoredItem.on("changed", (dataValue: DataValue) => {
                Array.from(this.machines.values()).map((machine)  => {
                    const nodeId = monitoredItem.itemToMonitor.nodeId.toString()
                    switch (nodeId) {
                        case "ns=0;i=2256":
                        case "i=2256":
                            this.serverStatus = dataValue.value.value
                            break;
                        case "ns=0;i=2267":
                        case "i=2267":
                            this.serviceLevel = dataValue.value.value
                            break;                    
                        default:
                            machine.notify(nodeId, dataValue)
                            break;
                    }
                })
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
                samplingInterval: 5000,
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
            }, 10000)
            return
        }
        await this.readServiceLevel()
        if (this.serviceLevel <= 200) {
            console.error(`OPC UA Client: OPC UA Device @ '${this.endpoint}' has insufficient ServiceLevel '${this.serviceLevel}'`)
            await this.client.disconnect()
            console.warn(`OPC UA Client: next attempt to connect to OPC UA Device @ '${this.endpoint}' in 10s`)
            setTimeout(async () => {
                await this.initialize()
            }, 10000)
            return
        }
        await this.readServerStatus()
        await this.readNameSpaceArray()
        await this.readServerProfileArray()
        await this.readDeviceLimits()
        this.updateSummery()
        await this.createSubscription()
        await this.setupChangeEvents()
        await this.findMachinesOnServer()
        await this.discoverFoundMachines()
        this.collectRelatedNodeIds()
        this.collectRelatedVariableNodeIds()
        const maxPerCall = this.deviceLimits.get("MaxMonitoredItemsPerCall") || 0
        const maxPerSub = this.deviceLimits.get("MaxMonitoredItemsPerSubscription") || 0
        if (
            (maxPerCall === 0 || maxPerCall >= this._relatedVariableNodeIds.size) &&
            (maxPerSub === 0 || (maxPerSub - 10) >= this._relatedVariableNodeIds.size)
        ) {
            console.log(`OPC UA Client: adding all '${this._relatedVariableNodeIds.size}' realated Variables and Properties to Subscription!`)
            await this.subscription!.monitorItems(
                Array.from(this._relatedVariableNodeIds.values()).map((id) => {
                    return {
                        nodeId: id,
                        attributeId: AttributeIds.Value,
                    } as ReadValueIdOptions
                }), 
                {
                    samplingInterval: 2000,
                    queueSize: 1000
                }, 
                TimestampsToReturn.Both
            )
        } else {
            console.warn(`OPC UA Client: unable to add realated Variables and Properties to Subscription due to DeviceLimits!`)
        }
        this._initialized = true
        if (
            this._queuedBaseModelChangeEvents.length > 0 ||
            this._queuedGeneralModelChangeEvents.length > 0 ||
            this._queuedSemanticChangeEvents.length > 0
        ) {
            await this.processQueuedChangeEvents()
        }
        this.findMachinesOnServerInterval = setInterval(async () => {
            if (this.isConnected() === false) return
            if (this.isSessionPresent() === false) return
            await this.findMachinesOnServer()
            const foundMachines = Array.from(this.foundMachines)
            for (let index = 0; index < foundMachines.length; index++) {
                const machineId = foundMachines[index];
                if (this._relatedNodeIdMap.has(machineId) === false) {
                    await this.discoverSingleMachine(machineId)
                }
            }
        }, 60 * 1000)
    }

    private updateSummery() {
        Object.assign(this.summery, {
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
        const machines = Array.from(this.machines.values())
        for (let index = 0; index < machines.length; index++) {
            const machine = machines[index] as UaMachineryMachine
            machine._relatedNodeIds.forEach((nodeId) => {
                this._relatedNodeIdMap.set(nodeId, machine)
            })
            const components: UaMachineryComponent[] = Array.from(machine.components.values())
            for (let index = 0; index < components.length; index++) {
                const component = components[index];
                component._relatedNodeIds.forEach((nodeId) => {
                    this._relatedNodeIdMap.set(nodeId, component)
                })
            }
            const processValues: UaProcessValue[] = Array.from(machine.monitoring.values())
            for (let index = 0; index < processValues.length; index++) {
                const processValue = processValues[index];
                processValue._relatedNodeIds.forEach((nodeId) => {
                    this._relatedNodeIdMap.set(nodeId, processValue)
                })
            }
        }

        const relatedNodes = Array.from(this._relatedNodeIdMap.keys())
        console.log(`OPC UA Client: contains '${relatedNodes.length}' related NodeId's`)
    }

    private collectRelatedVariableNodeIds() {
        this._relatedVariableNodeIds.clear()
        const machines = Array.from(this.machines.values())
        for (let index = 0; index < machines.length; index++) {
            const machine = machines[index] as UaMachineryMachine
            machine._relatedVariableNodeIds.forEach((nodeId) => {
                this._relatedVariableNodeIds.add(nodeId)
            })
            const components: UaMachineryComponent[] = Array.from(machine.components.values())
            for (let index = 0; index < components.length; index++) {
                const component = components[index];
                component._relatedNodeIds.forEach((nodeId) => {
                    this._relatedVariableNodeIds.add(nodeId)
                })
            }
            const processValues: UaProcessValue[] = Array.from(machine.monitoring.values())
            for (let index = 0; index < processValues.length; index++) {
                const processValue = processValues[index];
                processValue._relatedNodeIds.forEach((nodeId) => {
                    this._relatedVariableNodeIds.add(nodeId)
                })
            }
        }
        console.log(`OPC UA Client: contains '${this._relatedVariableNodeIds.size}' related Variable/Property-NodeId's`)
    }

    private async processQueuedChangeEvents() {
        console.log(`OPC UA Client: processing queued ChangeEvents [Base=${this._queuedBaseModelChangeEvents.length},General=${this._queuedGeneralModelChangeEvents.length},Semantic=${this._queuedSemanticChangeEvents.length}]`)
        const machines = Array.from(this.machines.values())
        if (this._queuedBaseModelChangeEvents.length > 0) {
            for (let index = 0; index < machines.length; index++) {
                // await machines[index].initialize()
            }
            this._queuedBaseModelChangeEvents = []
        }
        if (this._queuedGeneralModelChangeEvents.length > 0) {
            for (let index = 0; index < this._queuedGeneralModelChangeEvents.length; index++) {
                const values = this._queuedGeneralModelChangeEvents[index];
                await this.processGeneralModelChangeEvent(values)
            }
            this._queuedGeneralModelChangeEvents = []
        }
        if (this._queuedSemanticChangeEvents.length > 0) {
            // What to do?
            this._queuedSemanticChangeEvents = []
        }
    }

    private clearAllIntervals() {
        if (this.updateSummeryInterval !== undefined) clearInterval(this.updateSummeryInterval)
        if (this.findMachinesOnServerInterval !== undefined) clearInterval(this.findMachinesOnServerInterval!)
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
            if (this._initialized === false) {
                this._queuedBaseModelChangeEvents.push(values)
            } else {
                // TODO !!!
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
            if (this._initialized === false) {
                this._queuedGeneralModelChangeEvents.push(values)
            } else {
                await this.processGeneralModelChangeEvent(values)
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
            if (this._initialized === false) {
                this._queuedSemanticChangeEvents.push(values)
            } else {
                // TODO !!!
            }
        })
    }

    private async processGeneralModelChangeEvent(values: Variant[]) {
        let changesOccurred = false
        for (let index = 0; index < values.length; index++) {
            const variant = values[index];
            if (Array.isArray(variant.value)) {
                const changes = variant.value
                const toBeInitialized = new Set<UaMachineryMachine | UaMachineryComponent | UaProcessValue>()
                for (let index = 0; index < changes.length; index++) {
                    const change = changes[index];
                    const nodeId = change.affected.toString()
                    const verb: number = change.verb // The verb is an 8-bit unsigned integer used as bit mask
                    if ((verb & 0x00000001) === 0x00000001) {
                        // NodeAdded
                        console.warn(`OPC UA Client: NodeId='${nodeId}' has been added!`)
                    }
                    if ((verb & 0x00000010) === 0x00000010) {
                        // NodeDeleted
                        console.warn(`OPC UA Client: NodeId='${nodeId}' has been deleted!`)
                    }
                    if ((verb & 0x00000100) === 0x00000100) {
                        // ReferenceAdded
                        console.warn(`OPC UA Client: NodeId='${nodeId}' a Reference has been added!`)
                    }
                    if ((verb & 0x00001000) === 0x00001000) {
                        // ReferenceDeleted
                        console.warn(`OPC UA Client: NodeId='${nodeId}' a Reference has been deleted!`)
                    }
                    if ((verb & 0x00010000) === 0x00010000) {
                        // DataTypeChanged
                        console.warn(`OPC UA Client: NodeId='${nodeId}' datatype has been changed!`)
                    }
                    const item = this._relatedNodeIdMap.get(nodeId)
                    if (item !== undefined) {
                        toBeInitialized.add(item)
                    }
                }
                const arr = Array.from(toBeInitialized)
                if (arr.length > 0) {
                    changesOccurred = true
                }
                for (let index = 0; index < arr.length; index++) {
                    const item = arr[index];
                    console.log(`OPC UA Client: reinitializing item with nodeId='${item.nodeId}' class='${item.constructor.name}'`)
                    await item.initialize()
                }
            }
        }
        if (changesOccurred === true) {
            this.collectRelatedNodeIds()
            this.collectRelatedVariableNodeIds()
            const subscribedNodeIds = Array.from(this.monitoredItemValueMap.keys())
            const nodeids = Array.from(this._relatedVariableNodeIds)
            for (let index = 0; index < nodeids.length; index++) {
                const id = nodeids[index];
                if (subscribedNodeIds.includes(id) === false) {
                    await this.subscription!.monitor(
                        {
                            nodeId: id,
                            attributeId: AttributeIds.Value
                        },
                        {
                            samplingInterval: 2000,
                            queueSize: 1000
                        },
                        TimestampsToReturn.Both,
                        MonitoringMode.Reporting
                    )
                }
            }
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

    private async discoverSingleMachine(id: string) {
        try {
            const uaMachine = new UaMachineryMachine(this.session!, id, this.namespaceArray)
            await uaMachine.initialize()
            this.machines.set(`${id}`, uaMachine)        
        } catch (error) {
            console.log(error)
            console.error(`OPC UA Client: '${id}' is not a valid Machine! ${error}`)
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
        this.updateSummery()
        await writeJson("output.json", this.summery, {spaces: '    '})
        this.updateSummeryInterval = setInterval(async () => {
            if (this.isConnected() === false) return
            if (this.isSessionPresent() === false) return
            this.updateSummery()
            await writeJson("output.json", this.summery, {spaces: '    '})
            console.log("OPC UA Client: 'output.json' got updated!")
        }, 10000)
    }

    private async findMachinesOnServer() {
        console.log(`OPC UA Client: findMachinesOnServer...`)
        const machineryIndex = this.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/")
        if (machineryIndex === undefined) return
        const machinesFolderNodeId = `ns=${machineryIndex};i=1001` // id is defined in spec. and can be hardcoded!
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
