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
import { makeNodeIdStringFromExpandedNodeId } from "./ua-helper";
import { UaProcessValue } from "./ua-processvalue";

export class UaMachineryMachine {

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
     * A Map of all the found Identification-Properties
     */
    identification: Map<string, any> = new Map()

    /**
     * A Map of all the found MachineryComponents
     */    
    components: Map<string, UaMachineryComponent> = new Map()

    /**
     * A Map of all the found MachineryProcessValues
     */    
    monitoring: Map<string, UaProcessValue> = new Map()

    /**
     * Value of CurrentState-Variable of the MachineryItemState_StateMachine
     */   
    itemState: string | null = null

    /**
     * Value of CurrentState-Variable of the MachineryOperationMode_StateMachine
     */  
    operationMode: string | null = null

    /**
     * Last known initialization Date
     */   
    _lastInitialization = new Date()

    /**
     * A Set of known NodeId's
     */    
    _relatedNodeIds = new Set<string>()

    /**
     * HasComponent References
     */
    _components: ReferenceDescription[] = []
    
    /**
     * HasAddIn References
     */
    _addIns: ReferenceDescription[] = []

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
        await this.loadMachineTypeDefinition()
        const addIns = await this.getAddIns()
        if (addIns !== null) {
            this._addIns = addIns
        }
        const components = await this.getComponents()
        if (components !== null) {
            this._components = components
        }
        await this.discoverMachine()
        this._lastInitialization = new Date()
    }

    notify(nodeId: string, dataValue: DataValue) {
        Array.from(this.monitoring.values()).map((processValue)  => {
            processValue.notify(nodeId, dataValue)
        })
    }

    async discoverMachine() {
        await this.loadMachineIdentification()
        await this.loadMachineComponents()
        await this.loadMonitoring()
    }

    async loadMachineTypeDefinition() {
        const browseResult = await this.session!.browse({
            // nodeId?: (NodeIdLike | null);
            // browseDirection?: BrowseDirection;
            // referenceTypeId?: (NodeIdLike | null);
            // includeSubtypes?: UABoolean;
            // nodeClassMask?: UInt32;
            // resultMask?: UInt32;
            nodeId: this.nodeId,
            browseDirection: BrowseDirection.Forward,
            referenceTypeId: ReferenceTypeIds.HasTypeDefinition
        } as BrowseDescriptionLike)
        if (browseResult.references!.length > 1) {
            console.warn(`Machine-Instance '${this.nodeId}' as more then one TypeDefinition-Reference!`)
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
            // nodeId?: (NodeIdLike | null);
            // browseDirection?: BrowseDirection;
            // referenceTypeId?: (NodeIdLike | null);
            // includeSubtypes?: UABoolean;
            // nodeClassMask?: UInt32;
            // resultMask?: UInt32;
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
            // nodeId?: (NodeIdLike | null);
            // browseDirection?: BrowseDirection;
            // referenceTypeId?: (NodeIdLike | null);
            // includeSubtypes?: UABoolean;
            // nodeClassMask?: UInt32;
            // resultMask?: UInt32;
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
            if (readResult.statusCode.value === StatusCodes.Good.value) {
                if ((readResult.value.value as QualifiedName).name === "Identification") {
                    const identificationBrowseResults = await this.session.browse({
                        // nodeId?: (NodeIdLike | null);
                        // browseDirection?: BrowseDirection;
                        // referenceTypeId?: (NodeIdLike | null);
                        // includeSubtypes?: UABoolean;
                        // nodeClassMask?: UInt32;
                        // resultMask?: UInt32;
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasProperty
                    } as BrowseDescriptionLike)
                    identificationBrowseResults.references?.forEach((reference: ReferenceDescription) => {
                        this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(reference.nodeId))
                    })
                    if (identificationBrowseResults.statusCode.value === StatusCodes.Good.value) {
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
                            if (readResults[0].statusCode.value === StatusCodes.Good.value) {
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
            if (readResult.statusCode.value === StatusCodes.Good.value) {
                if ((readResult.value.value as QualifiedName).name === "Components") {
                    const componentBrowseResults = await this.session.browse({
                        // nodeId?: (NodeIdLike | null);
                        // browseDirection?: BrowseDirection;
                        // referenceTypeId?: (NodeIdLike | null);
                        // includeSubtypes?: UABoolean;
                        // nodeClassMask?: UInt32;
                        // resultMask?: UInt32;
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasComponent
                    } as BrowseDescriptionLike)
                    if (componentBrowseResults.statusCode.value === StatusCodes.Good.value) {
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

    async loadMonitoring() {
        if (this._components === null) return
        if (this._components.length === 0) return
        for (let index = 0; index < this._components.length; index++) {
            const id = this._components[index].nodeId;
            const readResult = await this.session.read({
                nodeId: id,
                attributeId: AttributeIds.BrowseName
            })
            if (readResult.statusCode.value === StatusCodes.Good.value) {
                if ((readResult.value.value as QualifiedName).name === "Monitoring") {
                    const monitoringBrowseResults = await this.session.browse({
                        // nodeId?: (NodeIdLike | null);
                        // browseDirection?: BrowseDirection;
                        // referenceTypeId?: (NodeIdLike | null);
                        // includeSubtypes?: UABoolean;
                        // nodeClassMask?: UInt32;
                        // resultMask?: UInt32;
                        nodeId: id,
                        browseDirection: BrowseDirection.Forward,
                        referenceTypeId: ReferenceTypeIds.HasComponent
                    } as BrowseDescriptionLike)
                    if (monitoringBrowseResults.statusCode.value === StatusCodes.Good.value) {
                        for (let index = 0; index < monitoringBrowseResults.references!.length; index++) {
                            // TODO check TypeDefinition!
                            const id = monitoringBrowseResults.references![index].nodeId;
                            const processValue = new UaProcessValue(this.session, makeNodeIdStringFromExpandedNodeId(id))
                            await processValue.initialize()
                            this.monitoring.set(`${id}`, processValue)
                            this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(id))
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