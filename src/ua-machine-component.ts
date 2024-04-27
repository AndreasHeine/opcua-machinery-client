import { AttributeIds, ClientSession, LocalizedText, ReadValueIdOptions, StatusCodes } from "node-opcua"

export class UaMachineryComponent {

    session: ClientSession
    nodeId: string
    displayName: string = ""

    constructor(session: ClientSession, nodeId: string) {
        this.session = session
        this.nodeId = nodeId
    }

    async initialize() {
        const readResults = await this.session.read([
            {
                nodeId: this.nodeId,
                attributeId: AttributeIds.DisplayName
            } as ReadValueIdOptions,
        ])
        if (readResults[0].statusCode.value === StatusCodes.Good.value) {
            this.displayName = `${(readResults[0].value.value as LocalizedText).text}`
        }
    }

    toJSON() {
        return {
            NodeId: this.nodeId,
            Attributes: {
                DisplayName: this.displayName
            }
        }
    }
}