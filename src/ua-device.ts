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
    QualifiedName,
    LocalizedText
} from 'node-opcua'
import { 
    isStatusCodeGoodish,
    makeNodeIdStringFromExpandedNodeId
} from './ua-helper';

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
    requestedSessionTimeout: 60*60*1000,
    endpointMustExist: false,
    keepSessionAlive: true,
    connectionStrategy: {
        initialDelay: 1000,
        maxDelay: 5000,
        maxRetry: 5
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
    private serverState: number = ServerState.Unknown
    private serviceLevel: number = 0

    readonly deviceLimits: Map<string, any> = new Map()

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
        await this.readNameSpaceArray()
        await this.readDeviceLimits()

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

        await this.setupChangeEvents()
        await this.discoverMachinesOnServer()
    }

    async disconnect() {
        await this.subscription?.terminate()
        await this.session?.close()
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
            console.warn(`OPC UA Client: BaseModelChangeEvent received! dataValue='${dataValue.toJSON()}'`)
            if (!this.reinitializing) await this.reinitialize()
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
            console.warn(`OPC UA Client: GeneralModelChangeEvent received! dataValue='${dataValue.toJSON()}'`)
            if (!this.reinitializing) await this.reinitialize()
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
            console.warn(`OPC UA Client: SemanticChangeEventType received! dataValue='${dataValue.toJSON()}'`)
            if (!this.reinitializing) await this.reinitialize()
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

        this.deviceLimits.forEach((value, key) => {
            console.log(`OPC UA Client: UaDeviceLimit -> '${key}': '${value}'`)
        })
    }

    private getNamespaceIndex(uri: string): number | undefined {
        const index = this.namespaceArray.indexOf(uri)
        return index === -1 ? undefined : index
    }

    private async discoverMachinesOnServer() {
        const machineryIndex = this.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/")
        if (machineryIndex === undefined) return

        const summery = {
            Server: {
                Endpoint: this.endpoint,
                ServerState: this.serverState,
                ServiceLevel: this.serviceLevel,
                NamespaceArray: this.namespaceArray,
                OperationalLimits: Object.fromEntries(this.deviceLimits.entries())
            },
            Machines: Object.create({})

        }

        const machinesFolderNodeId = `ns=${machineryIndex};i=1001`
        
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

        const machineList: string[] = []
        browseResult.references!.forEach((result) => {
            console.log(`OPC UA Client: found machine instance id='${result.nodeId.toString()}'`)
            machineList.push(makeNodeIdStringFromExpandedNodeId(result.nodeId))
        })

        const maschinesSummery = Object.create({})

        await Promise.all(machineList.map(async (id: string) => {
            const readResult = await this.session!.read([
                {
                    nodeId: id,
                    attributeId: AttributeIds.DisplayName
                } as ReadValueIdOptions,
                {
                    nodeId: id,
                    attributeId: AttributeIds.BrowseName
                } as ReadValueIdOptions,
                {
                    nodeId: id,
                    attributeId: AttributeIds.Description
                } as ReadValueIdOptions,
            ])

            const displayName = readResult[0].value.value
            const browseName = readResult[1].value.value
            const description = readResult[2].value.value

            maschinesSummery[`${displayName.text}`] = {
                NodeId: id,
                BrowseName: (browseName as QualifiedName).toJSON(),
                DisplayName: (displayName as LocalizedText).toJSON(),
                Description: (description as LocalizedText).toJSON()
            }
        }))

        Object.assign(summery.Machines, maschinesSummery)

        console.log(summery)
    }
}
