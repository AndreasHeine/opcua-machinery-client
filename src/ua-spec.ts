/*
 * Spec registry for OPC 40001-x (Machinery).
 *
 * Every NodeId and BrowseName that a model needs is declared HERE and nowhere else.
 * Convention for this repo: never inline a NodeId or a spec BrowseName inside a model -
 * import it from the spec modules (`ua-spec-machinery.ts`, `ua-spec-processvalues.ts`,
 * `ua-spec-jobs.ts`). That keeps the spec claim in one place and makes the coverage
 * report meaningful.
 *
 * NodeIds below are the numeric identifiers inside the named namespace
 * (verified against reference.opcfoundation.org, OPC-40001-1/-2/-3).
 */

export const NAMESPACES = {
    /* OPC 10000-x core namespace, always index 0. */
    core: "http://opcfoundation.org/UA/",
    machinery: "http://opcfoundation.org/UA/Machinery/",
    processValues: "http://opcfoundation.org/UA/Machinery/ProcessValues/",
    jobs: "http://opcfoundation.org/UA/Machinery/Jobs/",
    /* OPC 40001-2 builds its process values on the PA-DIM signal types of OPC 30081. */
    padim: "http://opcfoundation.org/UA/PADIM/",
    /* OPC 40001-3 delegates job handling to the ISA-95 job control types of OPC 10031-4. */
    isa95JobControl: "http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/",
    ia: "http://opcfoundation.org/UA/IA/",
    units: "http://www.opcfoundation.org/UA/units/un/cefact",
} as const;

export type NamespaceKey = keyof typeof NAMESPACES;

/* Core NodeIds the models compare type chains against (OPC 10000-3/-5/-8/-9/-16). */
export const CORE_TYPES: Record<string, TypeRef> = {
    baseObjectType: { ns: "core", id: 58, browseName: "BaseObjectType", clause: "OPC 10000-5" },
    baseDataVariableType: { ns: "core", id: 63, browseName: "BaseDataVariableType", clause: "OPC 10000-5" },
    propertyType: { ns: "core", id: 68, browseName: "PropertyType", clause: "OPC 10000-5" },
    folderType: { ns: "core", id: 61, browseName: "FolderType", clause: "OPC 10000-5" },
    stateMachineType: { ns: "core", id: 2299, browseName: "StateMachineType", clause: "OPC 10000-16" },
    twoStateVariableType: { ns: "core", id: 8995, browseName: "TwoStateVariableType", clause: "OPC 10000-9" },
    analogUnitType: { ns: "core", id: 17497, browseName: "AnalogUnitType", clause: "OPC 10000-8" },
    analogUnitRangeType: { ns: "core", id: 17570, browseName: "AnalogUnitRangeType", clause: "OPC 10000-8" },
    multiStateValueDiscreteType: { ns: "core", id: 11238, browseName: "MultiStateValueDiscreteType", clause: "OPC 10000-8" },
    exclusiveLimitAlarmType: { ns: "core", id: 9341, browseName: "ExclusiveLimitAlarmType", clause: "OPC 10000-9" },
    exclusiveDeviationAlarmType: { ns: "core", id: 9764, browseName: "ExclusiveDeviationAlarmType", clause: "OPC 10000-9" },
};

/* OPC 40001-1 §9.2 - the folder that organizes all machine instances. */
export const MACHINES_FOLDER_NODE_ID = 1001;

/* OPC 40001-1 §6.3.1 / §6.3.2 - well-known FolderType BrowseName and entry point. */
export const BUILDING_BLOCKS_FOLDER_BROWSE_NAME = "MachineryBuildingBlocks";

export type TypeRef = { ns: NamespaceKey; id: number; browseName: string; clause: string };

export const MACHINERY_TYPES: Record<string, TypeRef> = {
    machineIdentificationType: { ns: "machinery", id: 1012, browseName: "MachineIdentificationType", clause: "OPC 40001-1 §8.6" },
    machineryItemIdentificationType: { ns: "machinery", id: 1004, browseName: "MachineryItemIdentificationType", clause: "OPC 40001-1 §8.3" },
    machineryComponentIdentificationType: { ns: "machinery", id: 1005, browseName: "MachineryComponentIdentificationType", clause: "OPC 40001-1 §10.2" },
    imachineVendorNameplateType: { ns: "machinery", id: 1010, browseName: "IMachineVendorNameplateType", clause: "OPC 40001-1 §8.4" },
    imachineTagNameplateType: { ns: "machinery", id: 1011, browseName: "IMachineTagNameplateType", clause: "OPC 40001-1 §8.5" },
    imachineryItemVendorNameplateType: { ns: "machinery", id: 1003, browseName: "IMachineryItemVendorNameplateType", clause: "OPC 40001-1 §8.2" },
    machineComponentsType: { ns: "machinery", id: 1006, browseName: "MachineComponentsType", clause: "OPC 40001-1 §11.2" },
    machineryItemStateStateMachineType: { ns: "machinery", id: 1002, browseName: "MachineryItemState_StateMachineType", clause: "OPC 40001-1 §12.2" },
    machineryOperationModeStateMachineType: { ns: "machinery", id: 1008, browseName: "MachineryOperationModeStateMachineType", clause: "OPC 40001-1 §13.2" },
    machineryOperationCounterType: { ns: "machinery", id: 1009, browseName: "MachineryOperationCounterType", clause: "OPC 40001-1 §14.2" },
    monitoringType: { ns: "machinery", id: 1014, browseName: "MonitoringType", clause: "OPC 40001-1 §16.2" },
    machineryEquipmentFolderType: { ns: "machinery", id: 1013, browseName: "MachineryEquipmentFolderType", clause: "OPC 40001-1 §17.2" },
    imachineryEquipmentType: { ns: "machinery", id: 1007, browseName: "IMachineryEquipmentType", clause: "OPC 40001-1 §17.3" },
    machineryLifetimeCounterType: { ns: "machinery", id: 1015, browseName: "MachineryLifetimeCounterType", clause: "OPC 40001-1 §15.2" },
    notificationsType: { ns: "machinery", id: 1017, browseName: "NotificationsType", clause: "OPC 40001-1 §18.2" },
};

export type BuildingBlockKey =
    | "identification"
    | "components"
    | "itemState"
    | "operationMode"
    | "operationCounters"
    | "lifetimeCounters"
    | "monitoring"
    | "equipment"
    | "notifications";

export type BuildingBlockSpec = {
    key: BuildingBlockKey
    /* DefaultInstanceBrowseName(s) defined by the spec for this block. */
    browseNames: string[]
    /* TypeDefinition NodeIds whose subtype chain identifies the block. */
    typeRefs: TypeRef[]
    spec: string
    /* Feature id used by the coverage report. */
    feature: string
};

/*
 * Discovery order matters: blocks are looked up under the MachineryBuildingBlocks folder first
 * (§6.3.1), then as direct HasComponent / HasAddIn children of the item as a documented fallback.
 */
export const BUILDING_BLOCKS: BuildingBlockSpec[] = [
    {
        key: "identification",
        browseNames: ["Identification"],
        typeRefs: [
            MACHINERY_TYPES.machineIdentificationType,
            MACHINERY_TYPES.machineryItemIdentificationType,
            MACHINERY_TYPES.machineryComponentIdentificationType,
        ],
        spec: "OPC 40001-1 §8 / §10",
        feature: "machinery.identification",
    },
    {
        key: "components",
        browseNames: ["Components"],
        typeRefs: [MACHINERY_TYPES.machineComponentsType],
        spec: "OPC 40001-1 §11",
        feature: "machinery.components",
    },
    {
        key: "itemState",
        browseNames: ["MachineryItemState"],
        typeRefs: [MACHINERY_TYPES.machineryItemStateStateMachineType],
        spec: "OPC 40001-1 §12",
        feature: "machinery.itemState",
    },
    {
        key: "operationMode",
        browseNames: ["MachineryOperationMode"],
        typeRefs: [MACHINERY_TYPES.machineryOperationModeStateMachineType],
        spec: "OPC 40001-1 §13",
        feature: "machinery.operationMode",
    },
    {
        key: "operationCounters",
        browseNames: ["OperationCounters"],
        typeRefs: [MACHINERY_TYPES.machineryOperationCounterType],
        spec: "OPC 40001-1 §14",
        feature: "machinery.operationCounters",
    },
    {
        key: "lifetimeCounters",
        browseNames: ["LifetimeCounters"],
        typeRefs: [MACHINERY_TYPES.machineryLifetimeCounterType],
        spec: "OPC 40001-1 §15",
        feature: "machinery.lifetimeCounters",
    },
    {
        key: "monitoring",
        browseNames: ["Monitoring"],
        typeRefs: [MACHINERY_TYPES.monitoringType],
        spec: "OPC 40001-1 §16",
        feature: "machinery.monitoring",
    },
    {
        key: "equipment",
        browseNames: ["MachineryEquipment"],
        typeRefs: [MACHINERY_TYPES.machineryEquipmentFolderType, MACHINERY_TYPES.imachineryEquipmentType],
        spec: "OPC 40001-1 §17",
        feature: "machinery.equipment",
    },
    {
        key: "notifications",
        browseNames: ["Notifications"],
        typeRefs: [MACHINERY_TYPES.notificationsType],
        spec: "OPC 40001-1 §18",
        feature: "machinery.notifications",
    },
];

/* Identification properties expected from §8.3 / §8.4 / §8.5 (nameplate interfaces). */
export const IDENTIFICATION_PROPERTIES = [
    "Manufacturer", "ManufacturerUri", "ProductCode", "Model", "HardwareRevision", "RevisionCounter",
    "SoftwareRevision", "DeviceManual", "DeviceClass", "SerialNumber", "ProductInstanceUri",
    "RevisionId", "Id", "YearOfConstruction", "InitialOperationDate", "AssetId", "ComponentName",
    "Location", "DeviceHealth", "DeviceStatus",
];

/* Core-server NodeIds read for the Server section (OPC 10000-4). */
export const SERVER_NODE_IDS = {
    serverStatus: "i=2256",
    serverStatusState: "i=2259",
    serverStatusStartTime: "i=2257",
    serviceLevel: "i=2267",
    namespaceArray: "i=2255",
    serverCapabilitiesProfileArray: "i=2269",
    maxSubscriptionsPerSession: "i=24098",
    maxMonitoredItemsPerSubscription: "i=24104",
    maxMonitoredItemsPerCall: "i=11714",
    maxNodesPerMethodCall: "i=11709",
    maxNodesPerRead: "i=11705",
    maxNodesPerBrowse: "i=11704",
    maxNodesPerTranslateBrowsePathsToNodeIds: "i=11712",
    maxNodesPerRegisterNodes: "i=11706",
    maxNodesPerWrite: "i=11707",
};

export type FeatureSpec = { id: string; spec: string; title: string };

/* Everything the reference implementation reports on in `Coverage` / `GET /coverage`. */
export const FEATURES: FeatureSpec[] = [
    { id: "machinery.identification", spec: "OPC 40001-1 §8", title: "Machine identification and nameplate" },
    { id: "machinery.findMachines", spec: "OPC 40001-1 §9", title: "Finding all machines in a server" },
    { id: "machinery.componentIdentification", spec: "OPC 40001-1 §10", title: "Component identification and nameplate" },
    { id: "machinery.components", spec: "OPC 40001-1 §11", title: "Finding all components of a machine" },
    { id: "machinery.itemState", spec: "OPC 40001-1 §12", title: "MachineryItemState (CurrentState)" },
    { id: "machinery.operationMode", spec: "OPC 40001-1 §13", title: "MachineryOperationMode (CurrentState)" },
    { id: "machinery.operationCounters", spec: "OPC 40001-1 §14", title: "Operation counters" },
    { id: "machinery.lifetimeCounters", spec: "OPC 40001-1 §15", title: "Lifetime counters" },
    { id: "machinery.monitoring", spec: "OPC 40001-1 §16", title: "Monitoring building block" },
    { id: "machinery.equipment", spec: "OPC 40001-1 §17", title: "MachineryEquipment" },
    { id: "machinery.notifications", spec: "OPC 40001-1 §18", title: "Notifications" },
    { id: "machinery.modelChange", spec: "OPC 40001-1 §7.2", title: "Model change event handling" },
    { id: "processValues.types", spec: "OPC 40001-2 §7", title: "ProcessValueType instance (AnalogSignal, ranges, units)" },
    { id: "processValues.setpoint", spec: "OPC 40001-2 §9", title: "ProcessValueSetpoint and deviation variables" },
    { id: "processValues.limits", spec: "OPC 40001-2 §7.1", title: "Absolute limit variables (LowLow..HighHigh)" },
    { id: "processValues.percentage", spec: "OPC 40001-2 §7.1", title: "PercentageValue with dynamic ranges" },
    { id: "processValues.status", spec: "OPC 40001-2 §7.1", title: "Status / AlarmSuppression EnumValues" },
    { id: "processValues.alarms", spec: "OPC 40001-2 §7.1", title: "DeviationAlarm / LimitAlarm objects" },
    { id: "processValues.zeroPoint", spec: "OPC 40001-2 §7.1 / §8", title: "ZeroPointAdjustment method and event type" },
    { id: "jobs.management", spec: "OPC 40001-3 §8", title: "JobManagementType AddIn (read-only)" },
    { id: "jobs.orders", spec: "OPC 40001-3 §6 / OPC 10031-4", title: "JobOrderControl / JobOrderResults lists" },
];
