import { 
    AttributeIds, 
    BrowseDescriptionLike, 
    BrowseDirection, 
    ClientSession, 
    DataValue, 
    LocalizedText, 
    QualifiedName, 
    ReadValueIdOptions, 
    ReferenceTypeIds, 
    StatusCodes 
} from "node-opcua";
import { makeNodeIdStringFromExpandedNodeId } from "./ua-helper";
import assert from "assert";

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
        if (this.value.value.value === dataValue.value.value) return
        console.log(`OPC UA Client: DataChange nodeId='${this.nodeId}' displayName='${this.displayName}' old='${this.value.value.value}' new='${dataValue.value.value}'!`)
        this.value = dataValue
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            DisplayName: this.displayName,
            BrowseName: this.browseName,
            Description: this.description,
            Value: this.value.value.value
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
     * Additional References of the Machine-Instance-Object e.g. TypeDefinition
     */
    references: Map<string, any> = new Map()

    /**
     * A Set of known NodeId's associated with this class-instance
     */  
    _relatedNodeIds = new Set<string>()

    /**
     * A Set of known Variable-/Property-NodeId's associated with this class-instance
     */   
    _relatedVariableNodeIds = new Set<string>()

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
        const browseResult = await this.session!.browse({
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasTypeDefinition
        } as BrowseDescriptionLike)
        if (browseResult.references!.length > 1) {
            console.warn(`ProcessValue-Instance '${this.nodeId}' has more then one TypeDefinition-Reference!`)
        }
        const typeNodeId = makeNodeIdStringFromExpandedNodeId(browseResult.references![0].nodeId)
        this._relatedNodeIds.add(typeNodeId)
        const typeDefinitionReadResult: DataValue = await this.session.read({
            nodeId: browseResult.references![0].nodeId,
            attributeId: AttributeIds.DisplayName
        })
        this.references.set("TypeDefinition", (typeDefinitionReadResult.value.value as LocalizedText).text) 
        assert(`${(typeDefinitionReadResult.value.value as LocalizedText).text}` === "ProcessValueType")
        // AnalogSignal
        const processValueBrowseResults = await this.session.browse({
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasComponent
        } as BrowseDescriptionLike)
        if (processValueBrowseResults.statusCode.value === StatusCodes.Good.value) {
            for (let index = 0; index < processValueBrowseResults.references!.length; index++) {
                // TODO check TypeDefinition!
                const id = makeNodeIdStringFromExpandedNodeId(processValueBrowseResults.references![index].nodeId)
                const readResults = await this.session.read([
                    {
                        nodeId: id,
                        attributeId: AttributeIds.Value
                    } as ReadValueIdOptions,
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
                    } as ReadValueIdOptions
                ])
                const dataItem = new dataStoreItem(
                    id,
                    `${(readResults[1].value.value as LocalizedText).text}`,
                    `${(readResults[2].value.value as QualifiedName).toString()}`,
                    `${(readResults[3].value.value as LocalizedText).text}`,
                )
                dataItem.updateValue(readResults[0])
                this._relatedNodeIds.add(id)
                this._dataStore.set(id, dataItem)
                this._relatedVariableNodeIds.add(id)
            }
            // Range
            // EngeneeringUnit
        }
        // Tag
        const processValueBrowseResults2 = await this.session.browse({
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasProperty
        } as BrowseDescriptionLike)
        if (processValueBrowseResults2.statusCode.value === StatusCodes.Good.value) {
            for (let index = 0; index < processValueBrowseResults2.references!.length; index++) {
                // TODO check TypeDefinition!
                const id = makeNodeIdStringFromExpandedNodeId(processValueBrowseResults2.references![index].nodeId)
                const readResults = await this.session.read([
                    {
                        nodeId: id,
                        attributeId: AttributeIds.Value
                    } as ReadValueIdOptions,
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
                    } as ReadValueIdOptions
                ])
                const dataItem = new dataStoreItem(
                    id,
                    `${(readResults[1].value.value as LocalizedText).text}`,
                    `${(readResults[2].value.value as QualifiedName).toString()}`,
                    `${(readResults[3].value.value as LocalizedText).text}`,
                )
                dataItem.updateValue(readResults[0])
                this._relatedNodeIds.add(id)
                this._dataStore.set(id, dataItem)
                this._relatedVariableNodeIds.add(id)
            }
        }
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
            References: Object.fromEntries(this.references.entries()),
            Variables: Array.from(this._dataStore.values()).map((c) => {return c.toJSON()})
        }
    }
}