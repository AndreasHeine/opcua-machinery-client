import { 
    AttributeIds, 
    ClientSession, 
    DataValue, 
    LocalizedText, 
    QualifiedName, 
    ReadValueIdOptions, 
    StatusCodes 
} from "node-opcua";

export class dataStoreItem {

    private nodeId: string
    private displayName: string
    private browseName: string
    private description: string
    private value: DataValue = new DataValue()

    constructor(nodeId: string, displayName: string, browseName: string, description: string) {
        this.nodeId = nodeId
        this.displayName = displayName
        this.browseName = browseName
        this.description = description
    }

    updateValue(dataValue: DataValue) {
        this.value = dataValue
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            DisplayName: this.displayName,
            BrowseName: this.browseName,
            Description: this.description,
            Value: this.value.toJSON()
        }
    }
}

export class UaProcessValue {

    private session: ClientSession
    readonly nodeId: string

    /**
     * Attributes of the Machine-Instance-Object e.g. DisplayName, BrowseName and Description
     */
    attributes: Map<string, any> = new Map()

    /**
     * A Set of known NodeId's associated with this class-instance
     */  
    _relatedNodeIds = new Set<string>()

    /**
     * A Map containing all the all the dataStoreItem's 
     */
    _dataStore: Map<string, dataStoreItem> = new Map()

    constructor(session: ClientSession, nodeId: string) {
        this.session = session
        this.nodeId = nodeId
        this._relatedNodeIds.add(nodeId)
    }

    async initialize() {
        const readResults: DataValue[] = await this.session!.read([
            {
                nodeId: this.nodeId,
                attributeId: AttributeIds.DisplayName
            } as ReadValueIdOptions,
            {
                nodeId: this.nodeId,
                attributeId: AttributeIds.BrowseName
            } as ReadValueIdOptions,
            {
                nodeId: this.nodeId,
                attributeId: AttributeIds.Description
            } as ReadValueIdOptions,
        ])
        if (readResults[0].statusCode.value === StatusCodes.Good.value) {
            this.attributes.set("DisplayName", (readResults[0].value.value as LocalizedText).text)
        }
        if (readResults[1].statusCode.value === StatusCodes.Good.value) {
            this.attributes.set("BrowseName", (readResults[1].value.value as QualifiedName).toString())
        }
        if (readResults[2].statusCode.value === StatusCodes.Good.value) {
            this.attributes.set("Description", (readResults[2].value.value as LocalizedText).text)
        }
        await this.discoverMetaData()
    }

    async discoverMetaData() {
        // AnalogSignal
            // EURange
            // EngeneeringUnits
        // Tag
    }

    notify(nodeId: string, dataValue: DataValue) {
        if (this._relatedNodeIds.has(nodeId)) {
            const dataItem = this._dataStore.get(nodeId)
            if (dataItem === undefined) return
            dataItem.updateValue(dataValue)
        }
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            Values: Array.from(this._dataStore.values()).map((c) => {return c.toJSON()})
        }
    }
}