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
} from "node-opcua"
import { makeNodeIdStringFromExpandedNodeId } from "./ua-helper"

export class UaMachineryComponent {

    private session: ClientSession
    readonly nodeId: string

    /**
     * Attributes of the MachineComponent-Instance-Object e.g. DisplayName, BrowseName and Description
     */
    attributes: Map<string, any> = new Map()

    /**
     * Additional References of the MachineComponent-Instance-Object e.g. TypeDefinition
     */
    references: Map<string, any> = new Map()

    /**
     * A Map of all the found Identification-Properties
     */
    identification: Map<string, any> = new Map()

    /**
     * Last known initialization Date
     */   
    _lastInitialization = new Date()

    /**
     * A Set of known NodeId's associated with this class-instance
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
        await this.loadMachineComponentTypeDefinition()
        const addIns = await this.getAddIns()
        if (addIns !== null) {
            this._addIns = addIns
        }
        await this.discoverMetaData()
        this._lastInitialization = new Date()
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

    async loadMachineComponentTypeDefinition() {
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
            console.warn(`MachineComponent-Instance '${this.nodeId}' has more then one TypeDefinition-Reference!`)
        }
        this._relatedNodeIds.add(makeNodeIdStringFromExpandedNodeId(browseResult.references![0].nodeId))
        const typeDefinitionReadResult: DataValue = await this.session.read({
            nodeId: browseResult.references![0].nodeId,
            attributeId: AttributeIds.DisplayName
        })
        this.references.set("TypeDefinition", (typeDefinitionReadResult.value.value as LocalizedText).text) 
    }

    async discoverMetaData() {
        await this.loadMachineComponentIdentification()
    }

    async loadMachineComponentIdentification() {
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

    toJSON() {
        return {
            NodeId: this.nodeId,
            Attributes: Object.fromEntries(this.attributes.entries()),
            References: Object.fromEntries(this.references.entries()),
            Identification: Object.fromEntries(this.identification.entries()),
        }
    }
}