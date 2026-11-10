import { CORE_TYPES, TypeRef } from "./ua-spec";

/*
 * OPC 40001-2 Machinery Process Values - registry of the ProcessValueType instance declarations.
 *
 * Source: OPC 40001-2 7.1 (Table 1: ProcessValueType Definition, Table 2: Additional Subcomponents,
 * Table 3: Attribute values / EnumValues, Table 4: Additional References) and 9.1
 * (Table 6: ProcessValueSetpointVariableType Definition).
 *
 * ProcessValueType is a subtype of 3:AnalogSignalType (OPC 30081 / PA-DIM), and the
 * 3:AnalogSignal Variable it declares is an override of the mandatory AnalogSignalVariableType.
 * That is why the type chain of a conformant instance is:
 *   ProcessValueType <- AnalogSignalType (PA-DIM) <- ... and the AnalogSignal Variable itself is
 *   AnalogSignalVariableType <- AnalogUnitRangeType <- AnalogUnitType <- BaseDataVariableType.
 *
 * This module only declares what the spec declares. Discovery code asks the type resolver whether an
 * actual node matches one of these entries; it never hardcodes a NodeId itself.
 */

export const PROCESS_VALUE_TYPES: Record<string, TypeRef> = {
    processValueType: { ns: "processValues", id: 1003, browseName: "ProcessValueType", clause: "OPC 40001-2 7.1 Table 1" },
    zeroPointAdjustmentEventType: { ns: "processValues", id: 1002, browseName: "ZeroPointAdjustmentEventType", clause: "OPC 40001-2 8.1" },
    processValueSetpointVariableType: { ns: "processValues", id: 2003, browseName: "ProcessValueSetpointVariableType", clause: "OPC 40001-2 9.1 Table 6" },
    /* OPC 30081 (PA-DIM) supertypes that a conformant ProcessValueType instance chain must contain. */
    analogSignalType: { ns: "padim", id: 1022, browseName: "AnalogSignalType", clause: "OPC 30081 7.26" },
    analogSignalVariableType: { ns: "padim", id: 1111, browseName: "AnalogSignalVariableType", clause: "OPC 30081 8.2.2" },
};

export type ProcessValueChildSpec = {
    /* BrowseName as declared by the spec (namespace of the spec document, not of the instance). */
    browseName: string
    /* Where the child hangs on the instance. */
    reference: "HasComponent" | "HasProperty"
    nodeClass: "Variable" | "Object" | "Method"
    /* TypeDefinitions that identify the child; empty means "any node of that node class". */
    typeRefs: TypeRef[]
    /* Spec occurrence. */
    occurrence: "Mandatory" | "Optional"
    feature: string
    clause: string
    description: string
};

/* Table 1 - instance declarations of ProcessValueType itself. */
export const PROCESS_VALUE_CHILDREN: ProcessValueChildSpec[] = [
    {
        browseName: "AnalogSignal",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [PROCESS_VALUE_TYPES.analogSignalVariableType, CORE_TYPES.analogUnitRangeType],
        occurrence: "Mandatory",
        feature: "processValues.analogSignal",
        clause: "OPC 40001-2 7.1 Table 1",
        description: "The process value.",
    },
    {
        browseName: "SignalTag",
        reference: "HasProperty",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.propertyType],
        occurrence: "Mandatory",
        feature: "processValues.signalTag",
        clause: "OPC 30081 (inherited by OPC 40001-2 7.1)",
        description: "Identification of the signal.",
    },
    {
        browseName: "ProcessValueSetpoint",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [PROCESS_VALUE_TYPES.processValueSetpointVariableType, CORE_TYPES.analogUnitRangeType],
        occurrence: "Optional",
        feature: "processValues.setpoint",
        clause: "OPC 40001-2 7.1 Table 1 / 9.1",
        description: "The desired value, may or may not be controlled by the server.",
    },
    {
        browseName: "ZeroPointAdjustment",
        reference: "HasComponent",
        nodeClass: "Method",
        typeRefs: [],
        occurrence: "Optional",
        feature: "processValues.zeroPoint",
        clause: "OPC 40001-2 7.1 Table 1 / Table 4",
        description: "Zero point adjustment Method; generates a ZeroPointAdjustmentEventType (reported only, never called).",
    },
    {
        browseName: "DeviationAlarm",
        reference: "HasComponent",
        nodeClass: "Object",
        typeRefs: [CORE_TYPES.exclusiveDeviationAlarmType],
        occurrence: "Optional",
        feature: "processValues.alarms",
        clause: "OPC 40001-2 7.1 Table 1",
        description: "Becomes active when the process value deviates from the ProcessValueSetpoint.",
    },
    {
        browseName: "LimitAlarm",
        reference: "HasComponent",
        nodeClass: "Object",
        typeRefs: [CORE_TYPES.exclusiveLimitAlarmType],
        occurrence: "Optional",
        feature: "processValues.alarms",
        clause: "OPC 40001-2 7.1 Table 1",
        description: "Becomes active when absolute limits are reached.",
    },
    {
        browseName: "Status",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.multiStateValueDiscreteType],
        occurrence: "Optional",
        feature: "processValues.status",
        clause: "OPC 40001-2 7.1 Table 1 / Table 3",
        description: "Indicates if a limit or deviation has been reached (standardized EnumValues).",
    },
    {
        browseName: "AlarmSuppression",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.multiStateValueDiscreteType],
        occurrence: "Optional",
        feature: "processValues.status",
        clause: "OPC 40001-2 7.1 Table 1 / Table 3",
        description: "Indicates if alarms based on the Status shall be suppressed.",
    },
];

/* Table 2 - additional subcomponents below the AnalogSignal Variable. */
export const ANALOG_SIGNAL_CHILDREN: ProcessValueChildSpec[] = [
    {
        browseName: "PercentageValue",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitRangeType],
        occurrence: "Optional",
        feature: "processValues.percentage",
        clause: "OPC 40001-2 7.1 Table 2",
        description: "Process value in percentage, EngineeringUnits shall be percentage (UnitId 20529).",
    },
    {
        browseName: "LowLowLimit",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.limits",
        clause: "OPC 40001-2 7.1 Table 2",
        description: "Defines the absolute low low limit.",
    },
    {
        browseName: "LowLimit",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.limits",
        clause: "OPC 40001-2 7.1 Table 2",
        description: "Defines the absolute low limit.",
    },
    {
        browseName: "HighLimit",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.limits",
        clause: "OPC 40001-2 7.1 Table 2",
        description: "Defines the absolute high limit.",
    },
    {
        browseName: "HighHighLimit",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.limits",
        clause: "OPC 40001-2 7.1 Table 2",
        description: "Defines the absolute high high limit.",
    },
    {
        browseName: "ActualValue",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.baseDataVariableType],
        occurrence: "Optional",
        feature: "processValues.actualValue",
        clause: "OPC 30081 8.2.2 (inherited by OPC 40001-2 7.1)",
        description: "Unsimulated value during a simulation.",
    },
    {
        browseName: "SimulationValue",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.baseDataVariableType],
        occurrence: "Optional",
        feature: "processValues.simulation",
        clause: "OPC 30081 8.2.2 (inherited by OPC 40001-2 7.1)",
        description: "Value to be used when the signal is simulated.",
    },
    {
        browseName: "SimulationState",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.baseDataVariableType],
        occurrence: "Optional",
        feature: "processValues.simulation",
        clause: "OPC 30081 8.2.2 (inherited by OPC 40001-2 7.1)",
        description: "Indicates if the signal is simulated.",
    },
];

/* Properties provided by AnalogUnitType / AnalogUnitRangeType below the AnalogSignal Variable. */
export const ANALOG_SIGNAL_PROPERTIES: ProcessValueChildSpec[] = [
    {
        browseName: "EURange",
        reference: "HasProperty",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.propertyType],
        occurrence: "Mandatory",
        feature: "processValues.ranges",
        clause: "OPC 10000-8 (inherited by OPC 40001-2 7.1)",
        description: "Range of the value as a Range structure.",
    },
    {
        browseName: "EngineeringUnits",
        reference: "HasProperty",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.propertyType],
        occurrence: "Mandatory",
        feature: "processValues.engineeringUnits",
        clause: "OPC 10000-8 (inherited by OPC 40001-2 7.1)",
        description: "Engineering units as an EUInformation structure.",
    },
    {
        browseName: "InstrumentRange",
        reference: "HasProperty",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.propertyType],
        occurrence: "Optional",
        feature: "processValues.ranges",
        clause: "OPC 10000-8 (inherited by OPC 40001-2 7.1)",
        description: "Instrument range as a Range structure.",
    },
    {
        browseName: "ValuePrecision",
        reference: "HasProperty",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.propertyType],
        occurrence: "Optional",
        feature: "processValues.valuePrecision",
        clause: "OPC 10000-8 (inherited by OPC 40001-2 7.1)",
        description: "Precision of the value.",
    },
];

/* Table 6 - instance declarations of ProcessValueSetpointVariableType. */
export const SETPOINT_CHILDREN: ProcessValueChildSpec[] = [
    {
        browseName: "LowLowDeviation",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.deviation",
        clause: "OPC 40001-2 9.1 Table 6",
        description: "Low low limit for deviation, relative to the setpoint.",
    },
    {
        browseName: "LowDeviation",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.deviation",
        clause: "OPC 40001-2 9.1 Table 6",
        description: "Low limit for deviation, relative to the setpoint.",
    },
    {
        browseName: "HighDeviation",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.deviation",
        clause: "OPC 40001-2 9.1 Table 6",
        description: "High limit for deviation, relative to the setpoint.",
    },
    {
        browseName: "HighHighDeviation",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.analogUnitType],
        occurrence: "Optional",
        feature: "processValues.deviation",
        clause: "OPC 40001-2 9.1 Table 6",
        description: "High high limit for deviation, relative to the setpoint.",
    },
    {
        browseName: "SubstituteValue",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.baseDataVariableType],
        occurrence: "Optional",
        feature: "processValues.substituteValue",
        clause: "OPC 40001-2 9.1 Table 6",
        description: "Value to use when the setpoint cannot be controlled anymore.",
    },
    {
        browseName: "DeviationSensitivity",
        reference: "HasComponent",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.multiStateValueDiscreteType],
        occurrence: "Optional",
        feature: "processValues.deviationSensitivity",
        clause: "OPC 40001-2 9.1 Table 6 / Table 7",
        description: "FINE / MIDDLE / ROUGH tolerance sensitivity (standardized EnumValues).",
    },
    {
        browseName: "AutoDeviationAdjustment",
        reference: "HasProperty",
        nodeClass: "Variable",
        typeRefs: [CORE_TYPES.propertyType],
        occurrence: "Optional",
        feature: "processValues.deviationSensitivity",
        clause: "OPC 40001-2 9.1 Table 6",
        description: "Deviation variables are adjusted automatically when TRUE.",
    },
];

/* Table 3 - standardized EnumValues of the Status Variable. */
export const PROCESS_VALUE_STATUS_ENUMS: Record<number, string> = {
    0: "NONE - Not monitoring",
    1: "UNKNOWN - Status not known",
    2: "BELOW_LOWLOW_LIMIT - Value is below LowLowLimit",
    3: "BELOW_LOW_LIMIT - Value is below LowLimit",
    4: "BELOW_LOWLOW_DEVIATION - Value is below LowLowDeviation",
    5: "BELOW_LOW_DEVIATION - Value is below LowDeviation",
    6: "WITHIN_TOLERANCE - Value is in tolerance",
    7: "ABOVE_HIGH_DEVIATION - Value is above HighDeviation",
    8: "ABOVE_HIGHHIGH_DEVIATION - Value is above HighHighDeviation",
    9: "ABOVE_HIGH_LIMIT - Value is above HighLimit",
    10: "ABOVE_HIGHHIGH_LIMIT - Value is above HighHighLimit",
};

/* Table 3 - standardized EnumValues of the AlarmSuppression Variable. */
export const PROCESS_VALUE_ALARM_SUPPRESSION_ENUMS: Record<number, string> = {
    0: "OFF - no alarm suppression",
    1: "HORN - suppresses only horn",
    2: "COMPLETE - all alarms are suppressed",
};

/* Table 7 - standardized EnumValues of DeviationSensitivity. */
export const PROCESS_VALUE_DEVIATION_SENSITIVITY_ENUMS: Record<number, string> = {
    0: "FINE - tight tolerances",
    1: "MIDDLE - mean tolerances",
    2: "ROUGH - large tolerances",
};

/* EngineeringUnits of PercentageValue / percentage limits are fixed (OPC 40001-2 7.1). */
export const PERCENTAGE_UNIT = { namespaceUri: "http://www.opcfoundation.org/UA/units/un/cefact", unitId: 20529, displayName: "%", displayUnit: "percent" };
