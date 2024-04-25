import { 
    ExpandedNodeId,
    NodeId,
    NodeIdType,
    StatusCode,
    StatusCodes,
    // makeBrowsePath,
    // makeRelativePath,
    // assert
} from 'node-opcua'

export const isExpandedNodeId = function (str: string): boolean {
    let count = 0
    ;[";", "nsu="].forEach((value: string) => {
        if (str.includes(value)) count++
    })
    return count > 0
}

export const isBrowsePath = function (str: string): boolean {
    if (str.includes("/")) {
        if (!str.includes("nsu=")) {
            return true
        }
    }
    return false
}

export const isStatusCodeGoodish = function (st: StatusCode): boolean {
    switch (st.value) {
        case StatusCodes.Good.value:
        case StatusCodes.GoodCompletesAsynchronously.value:
        case StatusCodes.GoodClamped.value:
        case StatusCodes.GoodOverload.value:
        case StatusCodes.GoodLocalOverride.value:
        case StatusCodes.UncertainInitialValue.value:
        case StatusCodes.UncertainLastUsableValue.value:
        case StatusCodes.UncertainSubstituteValue.value:
            return true
            break
        default:
            return false
            break
    }
}

export const makeExpandedNodeIdFromString = function (str: string, namespaceArray: string[]): ExpandedNodeId {
    /*
        https://reference.opcfoundation.org/Core/docs/Part6/5.3.1/#5.3.1.11

        svr=<serverindex>ns=<namespaceindex><type>=<value>
        or
        svr=<serverindex>nsu=<uri><type>=<value>
    */
    const stringElements: string[] = str.split(';')
    let serverIndex: number | undefined  = undefined
    let uri: string | undefined = undefined
    let type: NodeIdType | undefined = undefined
    let identifier: any | undefined  = undefined
    let namespaceindex: number | undefined  = undefined
    stringElements.forEach((element: string) => {
        let [key, value] = element.split('=')
        switch (key) {
            case 'ns':
                // namespace
                namespaceindex = Number(value)
                break
            case 'i':

                // numeric identifier
                type = NodeIdType.NUMERIC
                identifier = Number(value)
                break
            case 's':
                // string identifier
                type = NodeIdType.STRING
                identifier = value
                break
            case 'g':
                // guid identifier
                type = NodeIdType.GUID
                identifier = value
                break
            case 'b':
                // bytestring identifier
                type = NodeIdType.BYTESTRING
                identifier = Buffer.from(value)
                break
            case 'srv':
                // serverindex
                serverIndex = Number(value)
                break
            case 'nsu':
                // namespaceuri
                uri = value
                break
            default: 
                break
        }
    })
    if (namespaceindex === undefined && uri !== undefined) {
        namespaceindex = namespaceArray.indexOf(uri)
    }
    if (uri === null) {
        throw new Error(`OPC-UA-Server: makeExpandedNodeIdFromString - Could not parse string: ${str}`)
    }
    const nid = new NodeId(type, identifier, namespaceindex)
    return ExpandedNodeId.fromNodeId(nid, uri, serverIndex)
}

/* FYI
    export declare enum NodeIdType {
        NUMERIC = 1,
        STRING = 2,
        GUID = 3,
        BYTESTRING = 4
*/

const identifierTypes = new Map()
identifierTypes.set(1, 'i')
identifierTypes.set(2, 's')
identifierTypes.set(3, 'g')
identifierTypes.set(4, 'b')

export const makeNodeIdStringFromExpandedNodeId = function (enid: ExpandedNodeId): string {
    // assert(enid.namespace != undefined, "makeNodeIdStringFromExpandedNodeId -> no namespace in ExpandedNodeId")
    // assert(enid.identifierType, "makeNodeIdStringFromExpandedNodeId -> no identifierType in ExpandedNodeId")
    // assert(enid.value, "makeNodeIdStringFromExpandedNodeId -> no value in ExpandedNodeId")
    return `ns=${enid.namespace};${identifierTypes.get(enid.identifierType)}=${enid.value}`

}
