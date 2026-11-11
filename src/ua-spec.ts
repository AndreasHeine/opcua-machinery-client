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
    /* OPC 40001-1 builds functional groups and lifetime variables on OPC 10000-100 (DI). */
    di: "http://opcfoundation.org/UA/DI/",
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
    stateType: { ns: "core", id: 2307, browseName: "StateType", clause: "OPC 10000-16" },
    transitionType: { ns: "core", id: 2310, browseName: "TransitionType", clause: "OPC 10000-16" },
};

/* OPC 10000-100 (DI) types the 40001-1 blocks are built on (§14 MachineryOperationCounterType, §15 LifetimeVariableType). */
export const DI_TYPES: Record<string, TypeRef> = {
    functionalGroupType: { ns: "di", id: 1005, browseName: "FunctionalGroupType", clause: "OPC 10000-100 §4.4" },
    lifetimeVariableType: { ns: "di", id: 468, browseName: "LifetimeVariableType", clause: "OPC 10000-100 §10.2" },
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

/*
 * One member declared by a block's TypeDefinition (NodeClass + DataType + requirement flag taken from
 * the spec table). req: M mandatory, O optional, MP mandatory placeholder, OP optional placeholder.
 * access is the spec's write semantics - this client is read-only and never writes any of them.
 */
export type SpecMember = {
    browseName: string
    nodeClass: "Object" | "Variable"
    dataType?: string
    typeDef?: TypeRef
    req: "M" | "O" | "MP" | "OP"
    access?: "RO" | "RW"
    clause: string
};

export type BuildingBlockSpec = {
    key: BuildingBlockKey
    /* DefaultInstanceBrowseName(s) defined by the spec for this block. */
    browseNames: string[]
    /* BrowseNames that additionally count as a candidate for this block: vendors deviate from the spec
       default (e.g. 'Equipment' instead of 'MachineryEquipment'); candidates are reported as foreign
       when the TypeDefinition chain does not match. */
    candidates: string[]
    /* TypeDefinition NodeIds whose subtype chain identifies the block. */
    typeRefs: TypeRef[]
    /* Members declared by the block TypeDefinition (spec member tables). */
    members: SpecMember[]
    /* Members expected on each Object child of the block (e.g. §17 MachineryEquipment children). */
    childMembers?: SpecMember[]
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
        candidates: ["Identification"],
        typeRefs: [
            MACHINERY_TYPES.machineIdentificationType,
            MACHINERY_TYPES.machineryItemIdentificationType,
            MACHINERY_TYPES.machineryComponentIdentificationType,
        ],
        /* Table 16 (§8.3) + Table 14 (§8.2); DeviceRevision is added by §10.2 on components only. */
        members: [
            { browseName: "Manufacturer", nodeClass: "Variable", dataType: "LocalizedText", req: "M", access: "RO", clause: "§8.2 / §8.3" },
            { browseName: "SerialNumber", nodeClass: "Variable", dataType: "String", req: "M", access: "RO", clause: "§8.2 / §8.3" },
            { browseName: "ProductInstanceUri", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "ManufacturerUri", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "Model", nodeClass: "Variable", dataType: "LocalizedText", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "ProductCode", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "HardwareRevision", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "SoftwareRevision", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "DeviceClass", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§8.3" },
            { browseName: "YearOfConstruction", nodeClass: "Variable", dataType: "UInt16", req: "O", access: "RO", clause: "§8.2" },
            { browseName: "MonthOfConstruction", nodeClass: "Variable", dataType: "Byte", req: "O", access: "RO", clause: "§8.2" },
            { browseName: "InitialOperationDate", nodeClass: "Variable", dataType: "DateTime", req: "O", access: "RO", clause: "§8.2" },
            { browseName: "AssetId", nodeClass: "Variable", dataType: "String", req: "O", access: "RW", clause: "§8.3 (ITagNameplateType)" },
            { browseName: "ComponentName", nodeClass: "Variable", dataType: "LocalizedText", req: "O", access: "RW", clause: "§8.3 (ITagNameplateType)" },
            { browseName: "DeviceRevision", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§10.2 (components only)" },
        ],
        spec: "OPC 40001-1 §8 / §10",
        feature: "machinery.identification",
    },
    {
        key: "components",
        browseNames: ["Components"],
        candidates: ["Components"],
        typeRefs: [MACHINERY_TYPES.machineComponentsType],
        /* Table 27 (§11.2): <Component> Object placeholder; Table 28: each <Component> HasAddIn
           Identification (MachineryItemIdentificationType) is M - checked on the component itself. */
        members: [
            { browseName: "<Component>", nodeClass: "Object", typeDef: CORE_TYPES.baseObjectType, req: "OP", clause: "§11.2" },
        ],
        spec: "OPC 40001-1 §11",
        feature: "machinery.components",
    },
    {
        key: "itemState",
        browseNames: ["MachineryItemState"],
        candidates: ["MachineryItemState"],
        typeRefs: [MACHINERY_TYPES.machineryItemStateStateMachineType],
        /* Table 30 (§12.2): states/transitions exist only on the TypeDefinition; the instance carries
           CurrentState (inherited from 0:StateMachineType, OPC 10000-16). */
        members: [
            { browseName: "CurrentState", nodeClass: "Variable", dataType: "LocalizedText", typeDef: CORE_TYPES.stateMachineType, req: "M", access: "RO", clause: "§12.2 / OPC 10000-16" },
            { browseName: "NotAvailable", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§12.2 (TypeDefinition only)" },
            { browseName: "OutOfService", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§12.2 (TypeDefinition only)" },
            { browseName: "NotExecuting", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§12.2 (TypeDefinition only)" },
            { browseName: "Executing", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§12.2 (TypeDefinition only)" },
        ],
        spec: "OPC 40001-1 §12",
        feature: "machinery.itemState",
    },
    {
        key: "operationMode",
        browseNames: ["MachineryOperationMode"],
        candidates: ["MachineryOperationMode"],
        typeRefs: [MACHINERY_TYPES.machineryOperationModeStateMachineType],
        /* Table 33 (§13.2): same pattern as §12 - states only on the TypeDefinition, CurrentState on the instance. */
        members: [
            { browseName: "CurrentState", nodeClass: "Variable", dataType: "LocalizedText", typeDef: CORE_TYPES.stateMachineType, req: "M", access: "RO", clause: "§13.2 / OPC 10000-16" },
            { browseName: "None", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§13.2 (TypeDefinition only)" },
            { browseName: "Maintenance", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§13.2 (TypeDefinition only)" },
            { browseName: "Setup", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§13.2 (TypeDefinition only)" },
            { browseName: "Processing", nodeClass: "Object", typeDef: CORE_TYPES.stateType, req: "O", clause: "§13.2 (TypeDefinition only)" },
        ],
        spec: "OPC 40001-1 §13",
        feature: "machinery.operationMode",
    },
    {
        key: "operationCounters",
        browseNames: ["OperationCounters"],
        candidates: ["OperationCounters", "MachineryOperationCounters"],
        typeRefs: [MACHINERY_TYPES.machineryOperationCounterType],
        /* Table 36 (§14.2): Duration is the OPC 10000-3 alias of Double, UInteger the alias of UInt32. */
        members: [
            { browseName: "PowerOnDuration", nodeClass: "Variable", dataType: "Duration", req: "O", access: "RO", clause: "§14.2" },
            { browseName: "OperationDuration", nodeClass: "Variable", dataType: "Duration", req: "O", access: "RO", clause: "§14.2" },
            { browseName: "OperationCycleCounter", nodeClass: "Variable", dataType: "UInteger", req: "O", access: "RO", clause: "§14.2" },
        ],
        spec: "OPC 40001-1 §14",
        feature: "machinery.operationCounters",
    },
    {
        key: "lifetimeCounters",
        browseNames: ["LifetimeCounters"],
        candidates: ["LifetimeCounters", "MachineryLifetimeCounters"],
        typeRefs: [MACHINERY_TYPES.machineryLifetimeCounterType],
        /* Table 39 (§15.2): at least one <LifetimeVariable> Variable (mandatory placeholder). */
        members: [
            { browseName: "<LifetimeVariable>", nodeClass: "Variable", dataType: "Number", typeDef: DI_TYPES.lifetimeVariableType, req: "MP", access: "RO", clause: "§15.2" },
        ],
        spec: "OPC 40001-1 §15",
        feature: "machinery.lifetimeCounters",
    },
    {
        key: "monitoring",
        browseNames: ["Monitoring"],
        candidates: ["Monitoring"],
        typeRefs: [MACHINERY_TYPES.monitoringType],
        /* Table 41 (§16.2): the four subfolder entry points; ProcessValue content is modelled by
           ua-processvalue.ts (OPC 40001-2), alarms/health by §16 subcomponents. */
        members: [
            { browseName: "Status", nodeClass: "Object", typeDef: CORE_TYPES.folderType, req: "O", clause: "§16.2" },
            { browseName: "Health", nodeClass: "Object", typeDef: CORE_TYPES.folderType, req: "O", clause: "§16.2" },
            { browseName: "Process", nodeClass: "Object", typeDef: CORE_TYPES.folderType, req: "O", clause: "§16.2" },
            { browseName: "Consumption", nodeClass: "Object", typeDef: CORE_TYPES.folderType, req: "O", clause: "§16.2" },
        ],
        spec: "OPC 40001-1 §16",
        feature: "machinery.monitoring",
    },
    {
        key: "equipment",
        browseNames: ["MachineryEquipment"],
        /* the umati demo server names its equipment folder 'Equipment' - a documented deviation candidate */
        candidates: ["MachineryEquipment", "Equipment"],
        typeRefs: [MACHINERY_TYPES.machineryEquipmentFolderType, MACHINERY_TYPES.imachineryEquipmentType],
        /* Table 45 (§17.2): placeholder Object per piece of equipment. */
        members: [
            { browseName: "<MachineryEquipment>", nodeClass: "Object", typeDef: CORE_TYPES.baseObjectType, req: "OP", clause: "§17.2" },
        ],
        /* Tables 47 / 49 (§17.2 / §17.3): expected Properties of each MachineryEquipment child. */
        childMembers: [
            { browseName: "MachineryEquipmentTypeId", nodeClass: "Variable", dataType: "String", req: "M", access: "RW", clause: "§17.3" },
            { browseName: "Description", nodeClass: "Variable", dataType: "LocalizedText", req: "O", access: "RW", clause: "§17.3" },
            { browseName: "EquipmentLife", nodeClass: "Variable", dataType: "Number", typeDef: DI_TYPES.lifetimeVariableType, req: "O", access: "RO", clause: "§17.3" },
            { browseName: "DeviceClass", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§17.2 (IVendorNameplateType)" },
            { browseName: "SerialNumber", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§17.2 (IVendorNameplateType)" },
            { browseName: "ManufacturerUri", nodeClass: "Variable", dataType: "String", req: "O", access: "RO", clause: "§17.2 (IVendorNameplateType)" },
            { browseName: "Model", nodeClass: "Variable", dataType: "LocalizedText", req: "O", access: "RO", clause: "§17.2 (IVendorNameplateType)" },
            { browseName: "ComponentName", nodeClass: "Variable", dataType: "LocalizedText", req: "O", access: "RW", clause: "§17.2" },
            { browseName: "AssetId", nodeClass: "Variable", dataType: "String", req: "O", access: "RW", clause: "§17.2" },
            { browseName: "Location", nodeClass: "Variable", dataType: "String", req: "O", access: "RW", clause: "§17.2" },
        ],
        spec: "OPC 40001-1 §17",
        feature: "machinery.equipment",
    },
    {
        key: "notifications",
        browseNames: ["Notifications"],
        /* the umati demo server names its notification folder 'Notification' (singular) */
        candidates: ["Notifications", "Notification"],
        typeRefs: [MACHINERY_TYPES.notificationsType],
        /* Table 51 (§18.2): no fixed members - notifications are events or child Objects. */
        members: [],
        spec: "OPC 40001-1 §18",
        feature: "machinery.notifications",
    },
];

/* Table 31 (§12.2) and Table 34 (§13.2) StateNumbers - declared states of the two state machines. */
export type SpecState = { name: string; stateNumber: number };

export const STATE_TABLES: Partial<Record<BuildingBlockKey, SpecState[]>> = {
    itemState: [
        { name: "NotAvailable", stateNumber: 0 },
        { name: "OutOfService", stateNumber: 1 },
        { name: "NotExecuting", stateNumber: 2 },
        { name: "Executing", stateNumber: 3 },
    ],
    operationMode: [
        { name: "None", stateNumber: 0 },
        { name: "Maintenance", stateNumber: 1 },
        { name: "Setup", stateNumber: 2 },
        { name: "Processing", stateNumber: 3 },
    ],
};

/* Identification properties expected from §8.3 / §8.4 / §8.5 (nameplate interfaces). */
export const IDENTIFICATION_PROPERTIES = [
    "Manufacturer", "ManufacturerUri", "ProductCode", "Model", "HardwareRevision", "RevisionCounter",
    "SoftwareRevision", "DeviceManual", "DeviceClass", "SerialNumber", "ProductInstanceUri",
    "RevisionId", "Id", "YearOfConstruction", "MonthOfConstruction", "DeviceRevision",
    "InitialOperationDate", "AssetId", "ComponentName", "Location", "DeviceHealth", "DeviceStatus",
];

/* Cross-block lookups used by the generic block discovery in ua-machine.ts. */
export const ALL_BLOCK_TYPE_REFS: TypeRef[] = BUILDING_BLOCKS.flatMap((block) => block.typeRefs);

export function findBuildingBlockByTypeRef(ref: TypeRef): BuildingBlockSpec | undefined {
    return BUILDING_BLOCKS.find((block) => block.typeRefs.some((blockRef) => blockRef.ns === ref.ns && blockRef.id === ref.id))
}

export function findBuildingBlockByBrowseName(browseName: string): BuildingBlockSpec | undefined {
    return BUILDING_BLOCKS.find((block) => block.candidates.includes(browseName))
}

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
