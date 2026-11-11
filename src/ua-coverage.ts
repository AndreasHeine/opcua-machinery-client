/*
 * Coverage report (Phase 6): aggregates what the connected server actually implements for
 * OPC 40001-1 / 40001-2 / 40001-3. Every feature declared in the FEATURES registry (ua-spec.ts)
 * gets found / missing / foreign counts computed from the discovered models.
 * Pure aggregation over the public model API - no browsing, no reads, never mutates the models.
 *
 * Status semantics per feature:
 * - 'found'        at least one spec TypeDefinition-matched instance was discovered
 * - 'foreign-only' the feature appears on the server only as a deviation (spec BrowseName,
 *                  foreign TypeDefinition chain) - reported, never claimed as coverage
 * - 'missing'      no instance found at all
 * - 'client'       client-side capability (model-change handling) - not a server feature
 */
import { FEATURES } from "./ua-spec";
import { UaMachineryMachine } from "./ua-machine";
import { UaMachineryComponent } from "./ua-machine-component";
import { TypeMatch } from "./ua-types";

export type FeatureCoverageStatus = "found" | "foreign-only" | "missing" | "client";
export type FeatureCoverageScope = "server" | "machine" | "instance" | "client";

export type FeatureCoverage = {
    Id: string
    Spec: string
    Title: string
    Scope: FeatureCoverageScope
    Status: FeatureCoverageStatus
    /* spec-matched instances (machines / blocks / components / ProcessValues / containers ...) */
    Found: number
    /* number of machines that carry at least one spec-matched instance of the feature */
    Machines: number
    /* machine-scoped features: machines that do NOT expose the feature; null otherwise */
    Missing: number | null
    /* deviations: spec BrowseName / name candidate with a foreign TypeDefinition chain */
    Foreign: number
    ForeignTypes: string[]
    Note?: string
}

export type ForeignTypeEntry = {
    Area: string
    BrowseName: string
    NodeId: string | null
    NamespaceUri: string | null
}

export type SpecAreaCoverage = {
    Spec: string
    Title: string
    Features: number
    Found: number
    ForeignOnly: number
    Missing: number
    Client: number
}

export type CoverageReport = {
    Machines: number
    MachinesFolder: string | null
    Specs: SpecAreaCoverage[]
    Features: FeatureCoverage[]
    ForeignTypes: ForeignTypeEntry[]
}

/* feature id prefix -> spec area */
const SPEC_AREAS: { prefix: string; spec: string; title: string }[] = [
    { prefix: "machinery.", spec: "OPC 40001-1", title: "Machinery Basic Building Blocks" },
    { prefix: "processValues.", spec: "OPC 40001-2", title: "Machinery Process Values" },
    { prefix: "jobs.", spec: "OPC 40001-3", title: "Machinery Job Management" },
]

const FEATURE_SCOPE: Record<string, FeatureCoverageScope> = {
    "machinery.identification": "machine",
    "machinery.findMachines": "server",
    "machinery.componentIdentification": "instance",
    "machinery.components": "machine",
    "machinery.itemState": "machine",
    "machinery.operationMode": "machine",
    "machinery.operationCounters": "machine",
    "machinery.lifetimeCounters": "machine",
    "machinery.monitoring": "machine",
    "machinery.equipment": "machine",
    "machinery.notifications": "machine",
    "machinery.modelChange": "client",
}

type Evidence = {
    found: number
    foreign: number
    machines: Set<string>
    types: Set<string>
    notes: Set<string>
}

export function buildCoverageReport(machines: Map<string, UaMachineryMachine>, machinesFolderNodeId: string | null): CoverageReport {
    const evidence = new Map<string, Evidence>()
    const foreignTypes = new Map<string, ForeignTypeEntry>()

    const ev = (featureId: string): Evidence => {
        let entry = evidence.get(featureId)
        if (entry === undefined) {
            entry = { found: 0, foreign: 0, machines: new Set<string>(), types: new Set<string>(), notes: new Set<string>() }
            evidence.set(featureId, entry)
        }
        return entry
    }
    const addForeignType = (area: string, match: TypeMatch | undefined, browseNameFallback: string) => {
        const browseName = match?.typeDefinition?.browseName ?? browseNameFallback
        const nodeId = match?.typeDefinition?.nodeId ?? null
        const key = nodeId ?? `${area}:${browseName}`
        if (foreignTypes.has(key)) return
        foreignTypes.set(key, {
            Area: area,
            BrowseName: browseName,
            NodeId: nodeId,
            NamespaceUri: match?.namespaceUri ?? null,
        })
    }
    const matchTypeBrowseName = (match: TypeMatch | undefined): string => {
        return match?.typeDefinition?.browseName ?? "unknown"
    }

    let totalComponents = 0
    let componentsWithIdentification = 0
    let machinesWithItemState = 0
    let machinesWithOperationMode = 0
    let totalProcessValues = 0
    let goodCurrentStateContainers = 0

    for (const machine of machines.values()) {
        /* building blocks: chain-matched candidates count as coverage, name-only candidates as foreign */
        for (const block of machine.blocks.values()) {
            const entry = ev(block.spec.feature)
            if (block.matched) {
                entry.found++
                entry.machines.add(machine.nodeId)
            } else {
                entry.foreign++
                entry.types.add(matchTypeBrowseName(block.match))
                addForeignType(`${block.spec.spec} building block`, block.match, block.ref.browseName)
            }
        }
        /* §10.2: every MachineryComponent should carry an Identification AddIn */
        const visitComponent = (machineId: string, component: UaMachineryComponent) => {
            totalComponents++
            if (component.identification.size > 0) {
                componentsWithIdentification++
                ev("machinery.componentIdentification").found++
                ev("machinery.componentIdentification").machines.add(machineId)
            } else {
                ev("machinery.componentIdentification").foreign++
            }
            component.components.forEach(visitComponent.bind(null, machineId))
        }
        machine.components.forEach(visitComponent.bind(null, machine.nodeId))

        if (machine.itemState !== null && machine.itemState !== undefined) machinesWithItemState++
        if (machine.operationMode !== null && machine.operationMode !== undefined) machinesWithOperationMode++

        /* OPC 40001-2: ProcessValue instances and their registry-classified children / alarms / methods */
        for (const processValue of machine.monitoring.values()) {
            totalProcessValues++
            ev("processValues.types").found++
            ev("processValues.types").machines.add(machine.nodeId)
            for (const child of processValue.children.values()) {
                if (child.specEntry === null || child.feature === null) continue
                const entry = ev(child.feature)
                if (child.specMatch) {
                    entry.found++
                    entry.machines.add(machine.nodeId)
                } else {
                    entry.foreign++
                    if (child.typeDefinition !== null) entry.types.add(child.typeDefinition)
                    addForeignType("OPC 40001-2 process value child", undefined, child.typeDefinition ?? child.browseName)
                }
            }
            for (const alarm of processValue.alarms.values()) {
                const feature = alarm.specEntry?.feature ?? "processValues.alarms"
                const entry = ev(feature)
                if (alarm.specMatch) {
                    entry.found++
                    entry.machines.add(machine.nodeId)
                } else {
                    entry.foreign++
                    if (alarm.typeDefinition !== null) entry.types.add(alarm.typeDefinition)
                    addForeignType("OPC 40001-2 alarm object", undefined, alarm.typeDefinition ?? alarm.browseName)
                }
            }
            for (const method of processValue.methods.values()) {
                const feature = method.specEntry?.feature ?? "processValues.zeroPoint"
                const entry = ev(feature)
                if (method.specMatch) {
                    entry.found++
                    entry.machines.add(machine.nodeId)
                } else {
                    entry.foreign++
                }
            }
        }
        /* §16: monitoring-looking subtrees whose chain misses the spec types are deviations of the block feature */
        for (const foreignMonitoring of machine.foreignMonitoring.values()) {
            const entry = ev("machinery.monitoring")
            entry.foreign++
            entry.types.add(matchTypeBrowseName(foreignMonitoring.match))
            addForeignType("OPC 40001-1 §16 monitoring content", foreignMonitoring.match, foreignMonitoring.ref.browseName)
        }

        /* OPC 40001-3: matched JobManagement AddIns, their ISA-95 containers, foreign name-only candidates */
        for (const jobs of machine.jobs.values()) {
            ev("jobs.management").found++
            ev("jobs.management").machines.add(machine.nodeId)
            for (const container of [jobs.control, jobs.results]) {
                if (container === null) continue
                const ordersEntry = ev("jobs.orders")
                if (container.specMatch) {
                    ordersEntry.found++
                    ordersEntry.machines.add(machine.nodeId)
                } else {
                    ordersEntry.foreign++
                    ordersEntry.types.add(matchTypeBrowseName(container.match))
                }
                if (container.declaration.browseName === "JobOrderControl") {
                    const stateEntry = ev("jobs.stateMachine")
                    if (container.specMatch) {
                        stateEntry.found++
                        stateEntry.machines.add(machine.nodeId)
                    } else {
                        stateEntry.foreign++
                    }
                    /* OPC 10031-4 6.2.1.2: the receiver's CurrentState shall always be Bad - Good is a deviation */
                    if (container.currentStateStatusCode !== null && container.currentStateStatusCode.startsWith("Good")) goodCurrentStateContainers++
                }
                /* ISA-95 declared members (OPC 10031-4 Table 12) that the container actually exposes.
                   'CurrentState' carries the jobs.stateMachine feature but that feature is measured on the
                   container itself (states live on the TypeDefinition) - counting the member would double-count. */
                for (const member of container.members.values()) {
                    if (member.feature === null || !member.declared || member.feature === "jobs.stateMachine") continue
                    const memberEntry = ev(member.feature)
                    memberEntry.found++
                    memberEntry.machines.add(machine.nodeId)
                }
                for (const method of container.methods.values()) {
                    if (!method.declared) continue
                    ev("jobs.methods").found++
                    ev("jobs.methods").machines.add(machine.nodeId)
                }
            }
        }
        for (const foreignJobs of machine.foreignJobs.values()) {
            const entry = ev("jobs.management")
            entry.foreign++
            entry.types.add(matchTypeBrowseName(foreignJobs.match))
            addForeignType("OPC 40001-3 job management content", foreignJobs.match, foreignJobs.ref.browseName)
        }
    }

    const totalMachines = machines.size

    /* feature notes that only make sense on top of the counts */
    if (totalMachines > 0) {
        const itemState = evidence.get("machinery.itemState")
        if (itemState !== undefined) itemState.notes.add(`'${machinesWithItemState}' of '${totalMachines}' machines report a non-null CurrentState`)
        const operationMode = evidence.get("machinery.operationMode")
        if (operationMode !== undefined) operationMode.notes.add(`'${machinesWithOperationMode}' of '${totalMachines}' machines report a non-null CurrentState`)
        const monitoring = evidence.get("machinery.monitoring")
        if (monitoring !== undefined && totalProcessValues > 0) monitoring.notes.add(`'${totalProcessValues}' ProcessValueType instance(s) found under spec or lookalike/foreign monitoring folders (see processValues.types)`)
    }
    const componentIdentification = evidence.get("machinery.componentIdentification")
    if (componentIdentification !== undefined && totalComponents > 0) componentIdentification.notes.add(`'${componentsWithIdentification}' of '${totalComponents}' components expose an Identification AddIn (OPC 40001-1 §10.2 Table 28: mandatory)`)
    const stateMachine = evidence.get("jobs.stateMachine")
    if (stateMachine !== undefined && goodCurrentStateContainers > 0) stateMachine.notes.add(`'${goodCurrentStateContainers}' JobOrderControl container(s) answer CurrentState with StatusCode Good although OPC 10031-4 6.2.1.2 requires Bad (recorded per machine as CurrentStateNote)`)

    const features: FeatureCoverage[] = FEATURES.map((feature) => {
        const entry = evidence.get(feature.id)
        const scope = FEATURE_SCOPE[feature.id] ?? "instance"
        const found = entry?.found ?? 0
        const foreign = entry?.foreign ?? 0
        const machineCount = entry?.machines.size ?? 0
        const status: FeatureCoverageStatus =
            scope === "client" ? "client" :
            found > 0 ? "found" :
            foreign > 0 ? "foreign-only" : "missing"
        const coverage: FeatureCoverage = {
            Id: feature.id,
            Spec: feature.spec,
            Title: feature.title,
            Scope: scope,
            Status: status,
            Found: scope === "client" ? 0 : found,
            Machines: scope === "client" ? 0 : machineCount,
            Missing: scope === "machine" ? totalMachines - machineCount : null,
            Foreign: foreign,
            ForeignTypes: Array.from(entry?.types ?? new Set<string>()).sort(),
        }
        if (feature.id === "machinery.findMachines") {
            coverage.Found = totalMachines
            coverage.Machines = totalMachines
            coverage.Status = totalMachines > 0 ? "found" : "missing"
            coverage.Note = machinesFolderNodeId !== null ? `'${totalMachines}' machines under Machines folder '${machinesFolderNodeId}' (OPC 40001-1 §9)` : `'${totalMachines}' machines found, Machines folder NodeId unknown`
        }
        if (feature.id === "machinery.modelChange") {
            coverage.Note = "client-side capability (OPC 10000-5 12.16 verb handling, re-scan, monitored-item sync) - server emission of ModelChangeEvents is not provable from the client side"
        }
        const notes = entry !== undefined ? Array.from(entry.notes) : []
        if (notes.length > 0) coverage.Note = notes.join("; ")
        return coverage
    })

    const specs: SpecAreaCoverage[] = SPEC_AREAS.map((area) => {
        const own = features.filter((feature) => feature.Id.startsWith(area.prefix))
        return {
            Spec: area.spec,
            Title: area.title,
            Features: own.length,
            Found: own.filter((feature) => feature.Status === "found").length,
            ForeignOnly: own.filter((feature) => feature.Status === "foreign-only").length,
            Missing: own.filter((feature) => feature.Status === "missing").length,
            Client: own.filter((feature) => feature.Status === "client").length,
        }
    })

    return {
        Machines: totalMachines,
        MachinesFolder: machinesFolderNodeId,
        Specs: specs,
        Features: features,
        ForeignTypes: Array.from(foreignTypes.values()).sort((a, b) => a.BrowseName.localeCompare(b.BrowseName)),
    }
}

/* Startup console lines: one line per spec area, so a demo audience sees what the server supports. */
export function formatCoverageSummaryLines(report: CoverageReport): string[] {
    const lines = report.Specs.map((area) => {
        const parts = [`found=${area.Found}`, `foreign-only=${area.ForeignOnly}`, `missing=${area.Missing}`]
        if (area.Client > 0) parts.push(`client-side=${area.Client}`)
        return `coverage '${area.Spec}' (${area.Title}): ${parts.join(' ')} of '${area.Features}' features`
    })
    const foreign = report.ForeignTypes.length
    if (foreign > 0) {
        lines.push(`coverage foreign types: '${foreign}' foreign/vendor TypeDefinition(s) encountered - see 'Coverage.ForeignTypes' / 'GET /coverage'`)
    }
    return lines
}
