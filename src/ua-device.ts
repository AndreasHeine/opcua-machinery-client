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
    ReadValueIdOptions,
    MonitoringParametersOptions,
    MonitoringMode,
} from 'node-opcua'
import { 
    isStatusCodeGoodish,
    makeNodeIdStringFromExpandedNodeId
} from './ua-helper';
import { writeJson } from 'fs-extra';
import { UaMachineryMachine } from './ua-machine';

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
    clientName: "opcua-machinery-client",
    requestedSessionTimeout: 60*60*1000,
    endpointMustExist: false,
    keepSessionAlive: true,
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
    requestedPublishingInterval: 1000,
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

    private namespaceArray: string[] = []
    private serverProfileArray: string[] = []
    private serverState: number = ServerState.Unknown
    private serverStatus: any = {}
    private serviceLevel: number = 0

    readonly deviceLimits: Map<string, any> = new Map()

    private foundMachines: string[] = []
    private machines: Map<string, any> = new Map()
    private _summery = Object.create({})

    reinitializing: boolean = false

    constructor (endpoint: string) {
        super();
        this.endpoint = endpoint;
        this.client = OPCUAClient.create(optionsInitial);
        this.client.on("backoff", (retry: number, delay: number) => {
            console.warn(`OPC UA Client: Unable to connect to the OPC UA Device @ '${endpoint}' - attempt '${retry}' retrying in '${delay / 1000.0}' seconds`)
        });
        this.client.on("connected", () => {
            console.log(`OPC UA Client: Connected to OPC UA Device @ '${endpoint}'`);
        })
        this.client.on("after_reconnection", async () => {
            console.warn(`OPC UA Client: Reconnected to OPC UA Device @ '${endpoint}'`);
            await this.readServerState()
            await this.readServiceLevel()
            await this.readNameSpaceArray()
            await this.readDeviceLimits()
        })
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
        this.subscription.on("status_changed", (status: StatusCode, diagnosticInfo: DiagnosticInfo) => {
            console.log(`OPC UA Client: Subscription status_changed! - ${status} - ${diagnosticInfo}`)
        })
        this.subscription.on("terminated", () => {
            console.warn(`OPC UA Client: Subscription terminated!`)
        })
        this.subscription.on("keepalive", () => {
            console.log(`OPC UA Client: Subscription keepalive!`)
        })
        this.subscription.on("error", (err: Error) => {
            console.error(`OPC UA Client: Subscription error! - ${err}`)
        })
        this.subscription.on("internal_error", (err: Error) => {
            console.error(`OPC UA Client: Subscription internal_error! - ${err}`)
        })

        const serverTimeMonitoredItem = await this.subscription.monitor(
            {
                // nodeId?: (NodeIdLike | null);
                // attributeId?: UInt32;
                // indexRange?: NumericRange;
                // dataEncoding?: (QualifiedNameLike | null);
                nodeId: "i=2258",
                attributeId: AttributeIds.Value
            } as ReadValueIdOptions,
            {
                // clientHandle?: UInt32;
                // samplingInterval?: Double;
                // filter?: (ExtensionObject | null);
                // queueSize?: UInt32;
                // discardOldest?: UABoolean;
                samplingInterval: 5000,
                queueSize: 1,
                discardOldest: false
            } as MonitoringParametersOptions,
            TimestampsToReturn.Both,
            MonitoringMode.Reporting
        )
        serverTimeMonitoredItem.on("changed", (dataValue: DataValue) => {
            // add to summery
        })
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

        Object.assign(this._summery, {
            Server: {
                Endpoint: this.endpoint,
                ServerState: this.serverState,
                ServiceLevel: this.serviceLevel,
                // ServerStatus: this.serverStatus.toJSON(), // TODO: Upper CamelCase!
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
        this.reinitializing = true
        await this.disconnect()
        await this.initialize()
        console.warn("OPC UA Client: reinitializing completed!")
        this.reinitializing = false
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
        baseModelChangeEventMonitoredItem.on("changed", async (dataValue: DataValue) => {
            // https://reference.opcfoundation.org/Core/Part3/9.32.7/
            console.warn(`OPC UA Client: BaseModelChangeEvent received!`)
            Array.from(this.machines.values()).forEach(machine => {
                machine.emit("BaseModelChangeEvent", dataValue)
            });
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
                    "EventId",
                    "EventType",
                    "SourceNode",
                    "SourceName",
                    "Time",
                    "ReceiveTime",
                    "Message",
                    "Severity",
                    "Changes"
                ], ofType("GeneralModelChangeEventType")),
                queueSize: 100000
            },
            TimestampsToReturn.Both
        )
        generalModelChangeEventMonitoredItem.on("changed", async (dataValue: DataValue) => {
            // https://reference.opcfoundation.org/Core/Part3/9.32.7/
            console.warn(`OPC UA Client: GeneralModelChangeEvent received!`)
            Array.from(this.machines.values()).forEach(machine => {
                machine.emit("GeneralModelChangeEvent", dataValue)
            });
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
                    "EventId",
                    "EventType",
                    "SourceNode",
                    "SourceName",
                    "Time",
                    "ReceiveTime",
                    "Message",
                    "Severity",
                    "Changes"
                ], ofType("SemanticChangeEventType")),
                queueSize: 100000
            },
            TimestampsToReturn.Both
        )
        semanticChangeEventMonitoredItem.on("changed", async (dataValue: DataValue) => {
            // https://reference.opcfoundation.org/Core/Part3/v104/docs/9.33
            console.warn(`OPC UA Client: SemanticChangeEventType received!`)
            Array.from(this.machines.values()).forEach(machine => {
                machine.emit("SemanticChangeEvent", dataValue)
            });
        })
    }

    private async readServerState() {
        // i=2259 [Server_ServerStatus_State]
        const dv = await this.session!.read({
            nodeId: "i=2259",
            attributeId: AttributeIds.Value
        })
        // check statuscode!
        this.serverState = dv?.value.value
        console.log(`OPC UA Client: read i=2259 [Server_ServerStatus_State] Value '${this.serverState}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readServerStatus() {
        // i=2256 [Server_ServerStatus]
        const dv = await this.session!.read({
            nodeId: "i=2256",
            attributeId: AttributeIds.Value
        })
        // check statuscode!
        this.serverStatus = dv?.value.value
        console.log(`OPC UA Client: read i=2256 [Server_ServerStatus_State] Value '${this.serverStatus}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readServiceLevel() {
        // i=2267 [Server_ServiceLevel]
        const dv = await this.session!.read({
            nodeId: "i=2267",
            attributeId: AttributeIds.Value
        })
        // check statuscode!
        this.serviceLevel = dv!.value.value
        console.log(`OPC UA Client: read i=2267 [Server_ServiceLevel] Value '${this.serviceLevel}' StatusCode '${dv.statusCode.name}'`)
    }

    private async readNameSpaceArray() {
        // i=2255 [Server_NamespaceArray]
        const dv = await this.session!.read({
            nodeId: "i=2255",
            attributeId: AttributeIds.Value
        })
        // check statuscode!
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

        console.log(`OPC UA Client: UaDeviceLimits -> '${JSON.stringify(Object.fromEntries(this.deviceLimits.entries()), null, "\t")}'`)
    }

    private async readServerProfileArray() {
        // i=2269 [Server_ServerCapabilities_ServerProfileArray]
        const dv = await this.session!.read({
            nodeId: "i=2269",
            attributeId: AttributeIds.Value
        })
        // check statuscode!
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
            console.log(`OPC UA Client: Loading MetaData from Machine [${index + 1}/${this.foundMachines.length}] -> id='${machineNodeId}'`)
            const uaMachine = new UaMachineryMachine(this.session!, machineNodeId)
            await uaMachine.initialize()
            this.machines.set(`${machineNodeId}`, uaMachine)
        }
        this._summery.Machines = Array.from(this.machines.values()).map((item) => {return item.toJSON()})
        // console.log(JSON.stringify(this._summery, null, '\t'))
        writeJson("output.json", this._summery, {spaces: '\t'})
        console.log("OPC UA Client: 'output.json' created!")
        await this.disconnect()
    }

    private async findMachinesOnServer() {
        const machineryIndex = this.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/")
        if (machineryIndex === undefined) return
        const machinesFolderNodeId = `ns=${machineryIndex};i=1001` // id is defined in spec. and can be hardcoded!
        const browseResult = await this.session!.browse({
            // nodeId?: (NodeIdLike | null);
            // browseDirection?: BrowseDirection;
            // referenceTypeId?: (NodeIdLike | null);
            // includeSubtypes?: UABoolean;
            // nodeClassMask?: UInt32;
            // resultMask?: UInt32;
            nodeId: machinesFolderNodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.Organizes
        } as BrowseDescriptionLike)
        browseResult.references!.forEach((result) => {
            this.foundMachines.push(makeNodeIdStringFromExpandedNodeId(result.nodeId))
        })
        console.log(`OPC UA Client: found '${this.foundMachines.length}' machine instances -> [${this.foundMachines}]`)
        // console.log(JSON.stringify(this._summery, null, '\t'))
    }
}
