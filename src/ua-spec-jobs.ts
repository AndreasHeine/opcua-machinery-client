import { CORE_TYPES, TypeRef } from "./ua-spec";

/*
 * OPC 40001-3 Machinery Job Management - registry (read-only view).
 *
 * OPC 40001-3 is thin on purpose: JobManagementType is an AddIn that wraps the ISA-95 job control
 * objects defined in OPC 10031-4 (namespace http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/).
 * OPC 40001-3 8.1 Table 4 declares:
 *
 *   JobManagementType (Subtype of 0:BaseObjectType)
 *     0:HasProperty  Variable  DefaultInstanceBrowseName  QualifiedName  PropertyType
 *     0:HasComponent Object    JobOrderControl            ISA95JobOrderReceiverObjectType    M
 *     0:HasComponent Object    JobOrderResults            ISA95JobResponseProviderObjectType M
 *
 * Everything below JobOrderControl / JobOrderResults is OPC 10031-4 and is modelled as a read-only
 * observation: the lists are monitored, the Methods are reported but never called.
 */

export const JOB_TYPES: Record<string, TypeRef> = {
    jobManagementType: { ns: "jobs", id: 1003, browseName: "JobManagementType", clause: "OPC 40001-3 8.1 Table 4" },
    isa95JobOrderReceiverObjectType: { ns: "isa95JobControl", id: 1002, browseName: "ISA95JobOrderReceiverObjectType", clause: "OPC 10031-4 6.2.1.2 Table 12" },
    isa95JobResponseProviderObjectType: { ns: "isa95JobControl", id: 1003, browseName: "ISA95JobResponseProviderObjectType", clause: "OPC 10031-4 6.2.7.1" },
    isa95JobOrderStatusEventType: { ns: "isa95JobControl", id: 1006, browseName: "ISA95JobOrderStatusEventType", clause: "OPC 10031-4 6.2.6" },
    /* Data types (OPC 10031-4 6.3) - used to decode the list Variables. */
    isa95JobOrderDataType: { ns: "isa95JobControl", id: 3008, browseName: "ISA95JobOrderDataType", clause: "OPC 10031-4 6.3.4" },
    isa95JobOrderAndStateDataType: { ns: "isa95JobControl", id: 3015, browseName: "ISA95JobOrderAndStateDataType", clause: "OPC 10031-4 6.3.3" },
    isa95JobResponseDataType: { ns: "isa95JobControl", id: 3013, browseName: "ISA95JobResponseDataType", clause: "OPC 10031-4 6.3.5" },
};

/* OPC 40001-3 8.1 Table 4 - the AddIn itself. */
export const JOB_MANAGEMENT_CHILDREN = [
    {
        browseName: "JobOrderControl",
        typeRef: JOB_TYPES.isa95JobOrderReceiverObjectType,
        occurrence: "Mandatory",
        feature: "jobs.orders",
        clause: "OPC 40001-3 8.1 Table 4",
        description: "Adds and controls job orders; read-only here (Methods are never called).",
    },
    {
        browseName: "JobOrderResults",
        typeRef: JOB_TYPES.isa95JobResponseProviderObjectType,
        occurrence: "Mandatory",
        feature: "jobs.orders",
        clause: "OPC 40001-3 8.1 Table 4",
        description: "Status of the running job orders.",
    },
];

/* OPC 40001-3 8.1 Table 5: DefaultInstanceBrowseName of JobManagementType is 'JobManagement'.
 * Candidate BrowseNames the discovery accepts before the TypeDefinition chain decides; 'Jobs' is the
 * vendor alias on the umati demo server (PlasticsRubber IMM2MES 'JobsType', reported as foreign). */
export const JOB_MANAGEMENT_INSTANCE_NAME = "JobManagement";
export const JOB_MANAGEMENT_CANDIDATE_NAMES: string[] = [JOB_MANAGEMENT_INSTANCE_NAME, "Jobs"];

/* OPC 40001-3 8.1 Table 4 - Properties declared on the AddIn itself. */
export const JOB_MANAGEMENT_PROPERTIES = [
    {
        browseName: "DefaultInstanceBrowseName",
        dataType: "QualifiedName",
        occurrence: "Declared",
        access: "RO",
        feature: "jobs.management",
        clause: "OPC 40001-3 8.1 Table 4 / Table 5",
        description: "Default BrowseName for instances of the type ('JobManagement' per Table 5).",
    },
];

/* OPC 10031-4 6.2.1.2 Table 12 - JobOrderControl (ISA95JobOrderReceiverObjectType) members. */
export const JOB_ORDER_CONTROL_MEMBERS = {
    /* Read-only list Variables. */
    variables: [
        {
            browseName: "CurrentState",
            dataType: "LocalizedText",
            occurrence: "Mandatory",
            access: "RO",
            feature: "jobs.stateMachine",
            clause: "OPC 10031-4 6.2.1.2",
            description: "CurrentState inherited from FiniteStateMachineType. Per spec it shall always return a Bad StatusCode - the receiver is only state metadata, real job states live in JobOrderList. A server that returns Good here is a deviation worth showing.",
        },
        { browseName: "JobOrderList", dataType: "ISA95JobOrderAndStateDataType[]", occurrence: "Mandatory", access: "RO", feature: "jobs.orderList", clause: "OPC 10031-4 6.2.1.2 Table 12" },
        { browseName: "WorkMaster", dataType: "ISA95WorkMasterDataType[]", occurrence: "Mandatory", access: "RO", feature: "jobs.workMaster", clause: "OPC 10031-4 6.2.1.2 Table 12" },
        { browseName: "MaterialClassID", dataType: "String[]", occurrence: "Mandatory", access: "RO", feature: "jobs.material", clause: "OPC 10031-4 6.2.1.2 Table 12" },
        { browseName: "MaterialDefinitionID", dataType: "String[]", occurrence: "Mandatory", access: "RO", feature: "jobs.material", clause: "OPC 10031-4 6.2.1.2 Table 12" },
        { browseName: "EquipmentID", dataType: "String[]", occurrence: "Mandatory", access: "RO", feature: "jobs.equipment", clause: "OPC 10031-4 6.2.1.2 Table 12" },
        { browseName: "PhysicalAssetID", dataType: "String[]", occurrence: "Mandatory", access: "RO", feature: "jobs.physicalAsset", clause: "OPC 10031-4 6.2.1.2 Table 12" },
        { browseName: "PersonnelID", dataType: "String[]", occurrence: "Mandatory", access: "RO", feature: "jobs.personnel", clause: "OPC 10031-4 6.2.1.2 Table 12" },
    ],
    properties: [
        { browseName: "MaxDownloadableJobOrders", dataType: "UInt16", occurrence: "Mandatory", access: "RO", feature: "jobs.capacity", clause: "OPC 10031-4 6.2.1.2 Table 12" },
    ],
    /*
     * Control Methods - Table 12 declares every one Optional. They are reported with their argument
     * signatures, never invoked: the write-side facet of OPC 40001-3 is deliberately out of scope.
     */
    methods: [
        { browseName: "Store", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.3" },
        { browseName: "StoreAndStart", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.4" },
        { browseName: "Start", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.5" },
        { browseName: "RevokeStart", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.6" },
        { browseName: "Pause", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.7" },
        { browseName: "Resume", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.8" },
        { browseName: "Update", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.9" },
        { browseName: "Abort", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.10" },
        { browseName: "Stop", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.10" },
        { browseName: "Cancel", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.12" },
        { browseName: "Clear", occurrence: "Optional", clause: "OPC 10031-4 6.2.1.13" },
    ],
    /* State machine states (the CurrentState of this state machine is defined as Bad on purpose). */
    states: ["NotAllowedToStart", "AllowedToStart", "Running", "Interrupted", "Ended", "Aborted"],
    stateNumbers: { NotAllowedToStart: 1, AllowedToStart: 2, Running: 3, Interrupted: 4, Ended: 5, Aborted: 6 } as Record<string, number>,
};

/* OPC 10031-4 6.2.7.1 - JobOrderResults (ISA95JobResponseProviderObjectType) members. */
export const JOB_ORDER_RESULTS_MEMBERS = {
    variables: [
        { browseName: "JobOrderResponseList", dataType: "ISA95JobResponseDataType[]", occurrence: "Optional", access: "RO", feature: "jobs.responseList", clause: "OPC 10031-4 6.2.7" },
    ],
    properties: [
    ],
    methods: [
        { browseName: "RequestJobResponseByJobOrderID", occurrence: "Optional", clause: "OPC 10031-4 6.2.7.2" },
        { browseName: "RequestJobResponseByJobOrderState", occurrence: "Optional", clause: "OPC 10031-4 6.2.7.3" },
    ],
    generatesEvent: JOB_TYPES.isa95JobOrderStatusEventType,
};

/*
 * JobOrderList / JobOrderResponseList entries are ISA-95 structures.
 * Field lists per OPC 10031-4 6.3.3 / 6.3.4 / 6.3.5 - decoding is tolerant: whatever the server
 * actually exposes is reported, the declared field list is only used to label the coverage report.
 */
export const JOB_ORDER_DATA_FIELDS = [
    "JobOrderID", "PreviousJobOrderID", "WorkMasterID", "MaterialClassID", "MaterialDefinitionID",
    "EquipmentID", "PhysicalAssetID", "PersonnelID", "OrderNumber", "OrderPriority", "Duration",
    "EarliestStart_date", "LatestEnd_date", "JobOrderQuantity", "JobOrderQuantityUOM",
    "JobOrderReworkCount", "JobOrderScrapCount", "Description",
];

export const JOB_ORDER_STATE_FIELDS = ["JobOrderState", "SubState", "Progress", "StateErrorMessage"];

export const JOB_RESPONSE_FIELDS = ["JobOrderID", "JobResponseID", "JobState", "Result", "Message"];

/* Types that identify the JobManagement AddIn when discovered under MachineryBuildingBlocks. */
export const JOB_MANAGEMENT_TYPE_REFS: TypeRef[] = [
    JOB_TYPES.jobManagementType,
    JOB_TYPES.isa95JobOrderReceiverObjectType,
    JOB_TYPES.isa95JobResponseProviderObjectType,
];

/* Core types JobManagement chains can end in (used only to explain foreign types in logs). */
export const JOB_BASE_TYPE_REFS: TypeRef[] = [CORE_TYPES.baseObjectType];
