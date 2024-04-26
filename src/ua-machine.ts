import { 
    AttributeIds, 
    BrowseDescriptionLike, 
    BrowseDirection, 
    ClientSession, 
    DataValue, 
    LocalizedText, 
    QualifiedName, 
    ReadValueIdOptions, 
    ReferenceDescription, 
    ReferenceTypeIds, 
    StatusCodes 
} from "node-opcua";

export class UaMachineryMachine {

    session: ClientSession
    nodeId: string
    attributes: Map<string, any> = new Map()
    identification: Map<string, any> = new Map()
    references: Map<string, any> = new Map()

    constructor(session: ClientSession, nodeId: string) {
        this.session = session
        this.nodeId = nodeId
    }

    async initialize() {
        console.log(`Exploring MachineInstance: ${this.nodeId}`)
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

        const typeDescriptions = await this.getMachineTypeDefinition()
        const typeDefinitionReadResult: DataValue = await this.session.read({
            nodeId: typeDescriptions![0].nodeId,
            attributeId: AttributeIds.DisplayName
        })
        this.references.set("TypeDefinition", (typeDefinitionReadResult.value.value as LocalizedText).text)

        await this.getMachineIdentification()
    }

    async getMachineTypeDefinition(): Promise<ReferenceDescription[] | null> {
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
        return browseResult.references  
    }

    async getMachineAddIns(): Promise<ReferenceDescription[] | null> {
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
        return browseResult.references
    }

    async getMachineComponents(): Promise<ReferenceDescription[] | null> {
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
        return browseResult.references
    }

    async getMachineIdentification() {
        const addIns = await this.getMachineAddIns()
        if (addIns === null) return
        if (addIns.length === 0) return
        for (let index = 0; index < addIns.length; index++) {
            const id = addIns[index].nodeId;
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
                                this.identification.set(`${(readResults[1].value.value as LocalizedText).text}`, readResults[0].value.value)
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
            Identification: Object.fromEntries(this.identification.entries()),
            References: Object.fromEntries(this.references.entries()),
        }
    }
}