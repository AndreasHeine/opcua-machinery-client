import { 
    AttributeIds, 
    BrowseDescriptionLike, 
    BrowseDirection, 
    ClientSession, 
    DataTypeIds, 
    DataValue, 
    LocalizedText, 
    QualifiedName, 
    ReadValueIdOptions, 
    ReferenceDescription, 
    ReferenceTypeIds, 
    StatusCodes 
} from "node-opcua";
import { UaMachineryComponent } from "./ua-machine-component";
import { isStatusCodeGoodish, makeNodeIdStringFromExpandedNodeId } from "./ua-helper";
import { UaProcessValue } from "./ua-processvalue";

export class UaMachineryMachine {

    private session: ClientSession
    readonly nodeId: string
    readonly namespaceArray: string[] = []

    /**
     * Attributes of the Machine-Instance-Object e.g. DisplayName, BrowseName and Description
     */
    readonly attributes: Map<string, any> = new Map()

    /**
     * Additional References of the Machine-Instance-Object e.g. TypeDefinition
     */
    readonly references: Map<string, any> = new Map()

    /**
     * A Map of all the found Identification-Properties
     */
    readonly identification: Map<string, any> = new Map()

    /**
     * A Map of all the found MachineryComponents
     */    
    readonly components: Map<string, UaMachineryComponent> = new Map()

    /**
     * A Map of all the found MachineryProcessValues
     */    
    readonly monitoring: Map<string, UaProcessValue> = new Map()

    /**
     * Value of CurrentState-Variable of the MachineryItemState_StateMachine
     */   
    itemState: string | null = null

    /**
     * 
     */
    itemStateNodeId: string | null = null

    /**
     * Value of CurrentState-Variable of the MachineryOperationMode_StateMachine
     */  
    operationMode: string | null = null

    /**
     * 
     */
    operationModeNodeId: string | null = null

    /**
     * Last known initialization Date
     */   
    _lastInitialization = new Date()

    /**
     * A Set of known NodeId's associated with this class-instance
     */    
    _relatedNodeIds = new Set<string>()

    /**
     * A Set of known Variable-/Property-NodeId's associated with this class-instance
     */   
    _relatedVariableNodeIds = new Set<string>()

    /**
     * HasComponent References
     */
    _components: ReferenceDescription[] = []

    /**
     * HasAddIn References
     */
    _addIns: ReferenceDescription[] = []

    constructor(session: ClientSession, nodeId: string, namespaceArray: string[]) {
        this.session = session
        this.nodeId = nodeId
        this.namespaceArray = namespaceArray
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
        await this.loadMachineTypeDefinition()
        const addIns = await this.getAddIns()
        if (addIns !== null) {
            this._addIns = addIns
        }
        const components = await this.getComponents()
        if (components !== null) {
            this._components = components
        }
        await this.discoverMetaData()
        this._lastInitialization = new Date()
    }

    notify(nodeId: string, dataValue: DataValue) {
        if (nodeId === this.itemStateNodeId) {
            this.itemState = `${(dataValue.value.value as LocalizedText).text}`
        }
        if (nodeId === this.operationModeNodeId) {
            this.operationMode = `${(dataValue.value.value as LocalizedText).text}`
        }
        Array.from(this.monitoring.values()).map((processValue)  => {
            processValue.notify(nodeId, dataValue)
        })
    }

    async discoverMetaData() {
        await this.loadMachineIdentification()
        await this.loadMachineComponents()
        await this.loadMonitoring()
        await this.loadBuildingBlocks()
    }

    async loadMachineTypeDefinition() {
        const browseResult = await this.session!.browse({
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasTypeDefinition
        } as BrowseDescriptionLike)
        if (browseResult.references!.length > 1) {
            console.warn(`Machine-Instance '${this.nodeId}' has more then one TypeDefinition-Reference!`)
        }
        this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(browseResult.references![0].nodeId))
        const typeDefinitionReadResult: DataValue = await this.session.read({
            nodeId: browseResult.references![0].nodeId,
            attributeId: AttributeIds.DisplayName
        })
        this.references.set("TypeDefinition", (typeDefinitionReadResult.value.value as LocalizedText).text) 
    }

    async getAddIns(): Promise<ReferenceDescription[] | null> {
        const browseResult = await this.session!.browse({
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasAddIn
        } as BrowseDescriptionLike)
        browseResult.references?.forEach((reference: ReferenceDescription) => {
            this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(reference.nodeId))
        })
        return browseResult.references
    }

    async getComponents(): Promise<ReferenceDescription[] | null> {
        const browseResult = await this.session!.browse({
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasComponent
        } as BrowseDescriptionLike)
        browseResult.references?.forEach((reference: ReferenceDescription) => {
            this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(reference.nodeId))
        })
        return browseResult.references
    }

    async loadMachineIdentification() {
        for (let index = 0; index < this._addIns.length; index++) {
            const id = this._addIns[index].nodeId;
            const readResult = await this.session.read({
                nodeId: id,
                attributeId: AttributeIds.BrowseName
            })
            if (isStatusCodeGoodish(readResult.statusCode)) {
                if ((readResult.value.value as QualifiedName).name === "Identification") {
                    const identificationBrowseResults = await this.session.browse({
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasProperty
                    } as BrowseDescriptionLike)
                    identificationBrowseResults.references?.forEach((reference: ReferenceDescription) => {
                        this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(reference.nodeId))
                    })
                    if (isStatusCodeGoodish(identificationBrowseResults.statusCode)) {
                        for (let index = 0; index < identificationBrowseResults.references!.length; index++) {
                            const id = identificationBrowseResults.references![index].nodeId;
                            const readResults = await this.session.read([
                                {
                                    nodeId: id,
                                    attributeId: AttributeIds.Value
                                } as ReadValueIdOptions,
                                {
                                    nodeId: id,
                                    attributeId: AttributeIds.DisplayName
                                } as ReadValueIdOptions,
                            ])
                            if (isStatusCodeGoodish(readResults[0].statusCode)) {
                                let value
                                switch (readResults[0].value.dataType.valueOf()) {
                                    case DataTypeIds.LocalizedText.valueOf():
                                        value = (readResults[0].value.value as LocalizedText).text
                                        break;
                                    default:
                                        value = readResults[0].value.value
                                        break;
                                }
                                this.identification.set(`${(readResults[1].value.value as LocalizedText).text}`, value)
                                this._relatedVariableNodeIds.add(makeNodeIdStringFromExpandedNodeId(id))
                            }
                        }
                    }
                }
            }
        }
    }

    async loadMachineComponents() {
        if (this._addIns === null) return
        if (this._addIns.length === 0) return
        for (let index = 0; index < this._addIns.length; index++) {
            const id = this._addIns[index].nodeId;
            const readResult = await this.session.read({
                nodeId: id,
                attributeId: AttributeIds.BrowseName
            })
            if (isStatusCodeGoodish(readResult.statusCode)) {
                if ((readResult.value.value as QualifiedName).name === "Components") {
                    const componentBrowseResults = await this.session.browse({
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasComponent
                    } as BrowseDescriptionLike)
                    if (isStatusCodeGoodish(componentBrowseResults.statusCode)) {
                        for (let index = 0; index < componentBrowseResults.references!.length; index++) {
                            const id = componentBrowseResults.references![index].nodeId;
                            const component = new UaMachineryComponent(this.session, makeNodeIdStringFromExpandedNodeId(id))
                            await component.initialize()
                            this.components.set(`${id}`, component)
                            this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(id))
                        }
                    }
                }
            }
        }
    }

    async loadProcessValue(id: string) {
        try {
            const processValue = new UaProcessValue(this.session, id)
            await processValue.initialize()
            this.monitoring.set(`${id}`, processValue)
            this._relatedNodeIds.add(id)
        } catch (error) {
            console.warn(`OPC UA Client: error while loading ProcessValue -> ${(error as Error).message}`)
        }  
    }

    async loadMonitoring() {
        if (this._components === null) return
        if (this._components.length === 0) return
        for (let index = 0; index < this._components.length; index++) {
            const id = this._components[index].nodeId;
            const readResult = await this.session.read({
                nodeId: id,
                attributeId: AttributeIds.BrowseName
            })
            if (isStatusCodeGoodish(readResult.statusCode)) {
                if ((readResult.value.value as QualifiedName).name === "Monitoring") {
                    // Check HasComponent references
                    const monitoringBrowseResults = await this.session.browse({
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasComponent
                    } as BrowseDescriptionLike)
                    if (isStatusCodeGoodish(monitoringBrowseResults.statusCode)) {
                        if (this.namespaceArray.includes("http://opcfoundation.org/UA/Machinery/ProcessValues/")) {
                            for (let index = 0; index < monitoringBrowseResults.references!.length; index++) {
                                const id = makeNodeIdStringFromExpandedNodeId(monitoringBrowseResults.references![index].nodeId);
                                await this.loadProcessValue(id)
                            }
                        }
                    }
                    // Check Organizes references
                    const monitoringBrowseResults2 = await this.session.browse({
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.Organizes
                    } as BrowseDescriptionLike)
                    if (isStatusCodeGoodish(monitoringBrowseResults2.statusCode)) {
                        if (this.namespaceArray.includes("http://opcfoundation.org/UA/Machinery/ProcessValues/")) {
                            for (let index = 0; index < monitoringBrowseResults2.references!.length; index++) {
                               const id = makeNodeIdStringFromExpandedNodeId(monitoringBrowseResults2.references![index].nodeId);
                               await this.loadProcessValue(id)
                           }
                        }
                    }
                }
            }
        }
    }

    async loadBuildingBlocks() {
        if (this._components === null) return
        if (this._components.length === 0) return
        for (let index = 0; index < this._components.length; index++) {
            const componentId = this._components[index].nodeId;
            const readResult = await this.session.read({
                nodeId: componentId,
                attributeId: AttributeIds.BrowseName
            })
            if (isStatusCodeGoodish(readResult.statusCode)) {
                if ((readResult.value.value as QualifiedName).name === "MachineryBuildingBlocks") {
                    const typeDefinitionBrowseResult = await this.session.browse({
                        nodeId: componentId,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasTypeDefinition
                    } as BrowseDescriptionLike)
                    if (typeDefinitionBrowseResult.references!.length > 1) {
                        console.warn(`Machine-Instance '${this.nodeId}' has more then one TypeDefinition-Reference!`)
                    }
                    const typeDefinitionNodeId = makeNodeIdStringFromExpandedNodeId(typeDefinitionBrowseResult.references![0].nodeId)
                    if (typeDefinitionNodeId !== "i=61" && typeDefinitionNodeId !== "ns=0;i=61") {
                        continue
                    }
                    const blocksBrowseResults = await this.session.browse({
                        nodeId: componentId,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasAddIn
                    } as BrowseDescriptionLike)
                    if (isStatusCodeGoodish(blocksBrowseResults.statusCode)) {
                        for (let index = 0; index < blocksBrowseResults.references!.length; index++) {
                            // TODO might be Component/Identification/... aswell!
                            const addinId = blocksBrowseResults.references![index].nodeId;
                            const typeDefinitionBrowseResult = await this.session!.browse({
                                nodeId: addinId,
                                browseDirection: BrowseDirection.Forward,
                                referenceTypeId: ReferenceTypeIds.HasTypeDefinition
                            } as BrowseDescriptionLike)
                            if (typeDefinitionBrowseResult.references!.length > 1) {
                                console.warn(`Machine-Instance '${this.nodeId}' has more then one TypeDefinition-Reference!`)
                            }
                            this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(typeDefinitionBrowseResult.references![0].nodeId))
                            const typeDefinitionReadResult: DataValue = await this.session.read({
                                nodeId: typeDefinitionBrowseResult.references![0].nodeId,
                                attributeId: AttributeIds.DisplayName
                            })
                            // TODO early exit here if not from type!
                            const stateMachineBrowseResults = await this.session.browse({
                                nodeId: addinId,
                                browseDirection: BrowseDirection.Forward,
                                referenceTypeId: ReferenceTypeIds.HasComponent
                            } as BrowseDescriptionLike)
                            if (isStatusCodeGoodish(stateMachineBrowseResults.statusCode)) {
                                for (let index = 0; index < stateMachineBrowseResults.references!.length; index++) {
                                    const id = makeNodeIdStringFromExpandedNodeId(stateMachineBrowseResults.references![index].nodeId)
                                    const readDisplayNameResult = await this.session.read({
                                        nodeId: id,
                                        attributeId: AttributeIds.DisplayName
                                    })
                                    if ((readDisplayNameResult.value.value as LocalizedText).text !== "CurrentState") continue
                                    const readResult: DataValue = await this.session.read({
                                        nodeId: id,
                                        attributeId: AttributeIds.Value
                                    })
                                    this._relatedNodeIds.add(id)
                                    switch ((typeDefinitionReadResult.value.value as LocalizedText).text) {
                                        case "ExtrusionMachineryItemState_StateMachineType": // Subtype
                                        case "MachineryItemState_StateMachineType":
                                            this.itemState = (readResult.value.value as LocalizedText).text
                                            this.itemStateNodeId = id
                                            break;
                                        case "MachineOperationModeStateMachineType": // Subtype
                                        case "MachineryOperationModeStateMachineType":
                                            this.operationMode = (readResult.value.value as LocalizedText).text
                                            this.operationModeNodeId = id
                                            break;
                                        default:
                                            break;
                                    }
                                    this._relatedVariableNodeIds.add(id)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            References: Object.fromEntries(this.references.entries()),
            Identification: Object.fromEntries(this.identification.entries()),
            Components: Array.from(this.components.values()).map((c) => {return c.toJSON()}),
            MachineryItemState: this.itemState,
            MachineryOperationMode: this.operationMode,
            Monitoring: Array.from(this.monitoring.values()).map((c) => {return c.toJSON()})
        }
    }
}