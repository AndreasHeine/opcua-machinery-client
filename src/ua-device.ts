import { EventEmitter } from 'events';
import { 
    OPCUAClient,
    OPCUAClientOptions,
    ClientSession,
    CreateSubscriptionRequestOptions,
    UserIdentityInfo,
    UserTokenType,
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

let userIdentityInfo: UserIdentityInfo = {
    type: UserTokenType.Anonymous
}

export class OpcUaDeviceClass extends EventEmitter {

    readonly endpoint: string
    readonly client: OPCUAClient

    private session: ClientSession | undefined
    private subscription: ClientSubscription | undefined
    private monitoredItemValueMap: Map<string, ClientMonitoredItem> = new Map()
    private namespaceArray: string[] = []
    private serverProfileArray: string[] = []
    private serverState: number = ServerState.Unknown
    private serverStatus: any = {}
    private serviceLevel: number = 0
    private deviceLimits: Map<string, any> = new Map()
    private foundMachines: string[] = []
    private machines: Map<string, any> = new Map()
    private summery = Object.create({})
    private _reinitializing: boolean = false
    private _relatedNodeIdMap: Map<string, UaMachineryMachine | UaMachineryComponent | UaProcessValue> = new Map()
    private _relatedVariableNodeIds = new Set<string>()
    private _initialized = false
    private _queuedBaseModelChangeEvents: Variant[][] = []
    private _queuedGeneralModelChangeEvents: Variant[][] = []
    private _queuedSemanticChangeEvents: Variant[][] = []

    constructor (endpoint: string) {
        super()
        this.endpoint = endpoint
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
            console.log(`OPC UA Client: securechannel token lifetime @ 75%! token='${token}'`)
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

    isConnected(): boolean {
        return this.client.isReconnecting
    }

    isSessionPresent(): boolean {
        if (this.session !== undefined) {
            return this.session!.isReconnecting
        } else {
            return false
        }
    }

    private async createSession(userIdentityInfo: UserIdentityInfo | undefined) {
        this.session = undefined
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
            console.log(`OPC UA Client: monitoredItem with nodeId='${monitoredItem.itemToMonitor.nodeId}' has been added to the Subscription!`)
            if (monitoredItem.itemToMonitor.attributeId.valueOf() !== AttributeIds.Value) return
            this.monitoredItemValueMap.set(monitoredItem.itemToMonitor.nodeId.toString(), monitoredItem)
            monitoredItem.on("changed", (dataValue: DataValue) => {
                Array.from(this.machines.values()).map((machine)  => {
                    machine.notify(monitoredItem.itemToMonitor.nodeId.toString(), dataValue)
                })
            })
        })

        this.subscription.monitor(
            {
                nodeId: "i=2256",
                attributeId: AttributeIds.Value
            },
            {
                samplingInterval: 5000,
                queueSize: 1
            },
            TimestampsToReturn.Both,
            MonitoringMode.Reporting
        )
    }

    async initialize() {
        await this.client.connect(this.endpoint)
        await this.createSession(userIdentityInfo)
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

        Object.assign(this.summery, {
            Server: {
                Endpoint: this.endpoint,
                ServerState: this.serverState,
                ServiceLevel: this.serviceLevel,
                ServerStatus: {
                    StartTime: this.serverStatus.startTime,
                    CurrentTime: this.serverStatus.currentTime,
                    State: this.serverStatus.state,
                    BuildInfo: {
                        ProductUri: this.serverStatus.buildInfo.productUri,
                        ManufacturerName: this.serverStatus.buildInfo.manufacturerName,
                        ProductName: this.serverStatus.buildInfo.productName,
                        SoftwareVersion: this.serverStatus.buildInfo.softwareVersion,
                        BuildNumber: this.serverStatus.buildInfo.buildNumber,
                        BuildDate: this.serverStatus.buildInfo.buildDate
                    },
                    SecondsTillShutdown: this.serverStatus.secondsTillShutdown,
                    ShutdownReason: `${this.serverStatus.shutdownReason.text}`
                },
                NamespaceArray: this.namespaceArray,
                ServerProfileArray: this.serverProfileArray,
                OperationalLimits: Object.fromEntries(this.deviceLimits.entries())
            },
            Machines: Object.fromEntries(this.machines.entries())
        })
        await this.createSubscription()
        await this.setupChangeEvents()

        await this.findMachinesOnServer()
        await this.discoverFoundMachines()

        this.collectRelatedNodeIds()
        this.collectRelatedVariableNodeIds()

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

        this._initialized = true

        if (
            this._queuedBaseModelChangeEvents.length > 0 ||
            this._queuedGeneralModelChangeEvents.length > 0 ||
            this._queuedSemanticChangeEvents.length > 0
        ) {
            await this.processQueuedChangeEvents()
        }
    }

    collectRelatedNodeIds() {
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

    collectRelatedVariableNodeIds() {
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

    async processQueuedChangeEvents() {
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

    async disconnect() {
        console.log(`OPC UA Client: terminating Subscription!`)
        await this.subscription?.terminate()
        console.log(`OPC UA Client: closing Session!`)
        await this.session?.close()
        console.log(`OPC UA Client: diconnecting!`)
        await this.client.disconnect()
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
            // const oldVariableNodeIds = this._relatedVariableNodeIds
            this.collectRelatedVariableNodeIds()
            // TODO Update Subscription!
        }
    }

    private async readServerState() {
        // i=2259 [Server_ServerStatus_State]
        const dv = await this.session!.read({
            nodeId: "i=2259",
            attributeId: AttributeIds.Value
        })
        // TODO check statuscode!
        this.serverState = dv?.value.value
        console.log(`OPC UA Client: read i=2259 [Server_ServerStatus_State] Value '${this.serverState}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readServerStatus() {
        // i=2256 [Server_ServerStatus]
        const dv = await this.session!.read({
            nodeId: "i=2256",
            attributeId: AttributeIds.Value
        })
        // TODO check statuscode!
        this.serverStatus = dv?.value.value
        console.log(`OPC UA Client: read i=2256 [Server_ServerStatus] Value '${JSON.stringify(this.serverStatus)}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readServiceLevel() {
        // i=2267 [Server_ServiceLevel]
        const dv = await this.session!.read({
            nodeId: "i=2267",
            attributeId: AttributeIds.Value
        })
        // TODO check statuscode!
        this.serviceLevel = dv!.value.value
        console.log(`OPC UA Client: read i=2267 [Server_ServiceLevel] Value '${this.serviceLevel}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readNameSpaceArray() {
        // i=2255 [Server_NamespaceArray]
        const dv = await this.session!.read({
            nodeId: "i=2255",
            attributeId: AttributeIds.Value
        })
        // TODO check statuscode!
        this.namespaceArray = dv!.value.value
        console.log(`OPC UA Client: read i=2255 [Server_NamespaceArray] Value '[${this.namespaceArray}]' StatusCode '${dv.statusCode.name}'`)
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
        // TODO check statuscode!
        this.serverProfileArray = dv!.value.value
        console.log(`OPC UA Client: read i=2269 [Server_ServerCapabilities_ServerProfileArray] Value '[${this.serverProfileArray}]' StatusCode '${dv.statusCode.name}'`)
    }   

    private getNamespaceIndex(uri: string): number | undefined {
        const index = this.namespaceArray.indexOf(uri)
        return index === -1 ? undefined : index
    }

    private async discoverFoundMachines() {
        for (let index = 0; index < this.foundMachines.length; index++) {
            const machineNodeId = this.foundMachines[index]
            console.log(`OPC UA Client: Loading MetaData from Machine [${index + 1}/${this.foundMachines.length}] with id='${machineNodeId}'`)
            const uaMachine = new UaMachineryMachine(this.session!, machineNodeId)
            await uaMachine.initialize()
            this.machines.set(`${machineNodeId}`, uaMachine)
        }

        this.summery.Machines = Array.from(this.machines.values()).map((item) => {return item.toJSON()})
        await writeJson("output.json", this.summery, {spaces: '    '})

        setInterval(async () => {
            await writeJson("output.json", this.summery, {spaces: '    '})
            console.log("OPC UA Client: 'output.json' got updated!")
            this.summery.Machines = Array.from(this.machines.values()).map((item) => {return item.toJSON()})
        }, 10000)
    }

    private async findMachinesOnServer() {
        const machineryIndex = this.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/")
        if (machineryIndex === undefined) return
        const machinesFolderNodeId = `ns=${machineryIndex};i=1001` // id is defined in spec. and can be hardcoded!
        const browseResult = await this.session!.browse({
            nodeId: machinesFolderNodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.Organizes
        } as BrowseDescriptionLike)
        browseResult.references!.forEach((result) => {
            this.foundMachines.push(makeNodeIdStringFromExpandedNodeId(result.nodeId))
        })
        console.log(`OPC UA Client: found '${this.foundMachines.length}' machine instances!`)
    }
}
