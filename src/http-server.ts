import express, { Request, Response } from "express"
import { Server } from "http"

/*
 * Read-only REST view over the in-memory summary (the same object as output.json, Phase 6 v2 shape):
 * { Server, Machinery: { Machines: [...] }, Coverage }.
 * The v1 'Machines' top level is still accepted so the existing endpoints stay compatible.
 * Endpoints:
 *   GET /health
 *   GET /server
 *   GET /machines                                  all machines
 *   GET /machines?productInstanceUri=...           filter by Identification.ProductInstanceUri
 *   GET /machines/:nodeId                          one machine (NodeId is URL-encoded, e.g. ns%3D50%3Bs%3DMyMachine)
 *   GET /machines/:nodeId/processvalues            OPC 40001-2 ProcessValues of one machine
 *   GET /machines/:nodeId/jobs                     OPC 40001-3 JobManagement results of one machine
 *   GET /coverage                                  what this server implements (found / missing / foreign)
 */

export type OutputData = {
    Server?: unknown
    Machinery?: {
        Machines?: MachineSummary[]
    }
    /* v1 fallback - a summary written before the Phase 6 shape change */
    Machines?: MachineSummary[]
    Coverage?: unknown
}

type MachineSummary = {
    NodeId?: string
    Identification?: {
        ProductInstanceUri?: string | null
    }
    ProcessValues?: unknown[]
    Jobs?: unknown[]
    ForeignJobCandidates?: unknown[]
}

function machinesOf(data: OutputData): MachineSummary[] {
    if (Array.isArray(data.Machinery?.Machines)) return data.Machinery.Machines
    if (Array.isArray(data.Machines)) return data.Machines
    return []
}

function sendError(response: Response, status: number, message: string) {
    response.status(status).json({ error: message })
}

export function startHttpServer(getData: () => OutputData, port = 3000): Server {
    const app = express()

    const readData = (response: Response): OutputData | null => {
        try {
            return getData()
        } catch (error) {
            sendError(response, 500, `Unable to read OPC UA summary: ${(error as Error).message}`)
            return null
        }
    }

    const findMachine = (request: Request, response: Response): MachineSummary | null => {
        const nodeId = `${request.params.nodeId ?? ""}`.trim()
        const machine = machinesOf(readData(response) ?? {}).find((candidate) => candidate.NodeId === nodeId)
        if (machine === undefined) {
            sendError(response, 404, `No machine with NodeId '${nodeId}' - use 'GET /machines' for the known NodeIds (URL-encode '=' as %3D, e.g. '/machines/ns%3D50%3Bs%3DMyMachine')`)
            return null
        }
        return machine
    }

    app.get("/health", (_request: Request, response: Response) => {
        const data = readData(response)
        if (data === null) return
        const machines = machinesOf(data)
        const server = data.Server as { Connected?: boolean; ServerState?: number | null; ServiceLevel?: number | null } | undefined
        const initialized = machines.length > 0 && server !== undefined
        response.status(initialized ? 200 : 503).json({
            Status: initialized ? "ok" : "initializing",
            Connected: server?.Connected ?? false,
            ServerState: server?.ServerState ?? null,
            ServiceLevel: server?.ServiceLevel ?? null,
            Machines: machines.length,
        })
    })

    app.get("/server", async (_request: Request, response: Response) => {
        const data = readData(response)
        if (data === null) return
        response.json(data.Server ?? null)
    })

    app.get("/coverage", async (_request: Request, response: Response) => {
        const data = readData(response)
        if (data === null) return
        if (data.Coverage === undefined) {
            sendError(response, 503, "Coverage is not available yet - the client has not finished its first machine scan")
            return
        }
        response.json(data.Coverage)
    })

    app.get("/machines", async (request: Request, response: Response) => {
        const data = readData(response)
        if (data === null) return
        const machines = machinesOf(data)
        const productInstanceUri = `${request.query.productInstanceUri ?? ""}`.trim()

        if (productInstanceUri.length === 0) {
            response.json(machines)
            return
        }

        response.json(
            machines.filter((machine) => machine.Identification?.ProductInstanceUri === productInstanceUri)
        )
    })

    /* express decodes %3D / %3B back to '=' / ';' - NodeIds are matched exactly */
    app.get("/machines/:nodeId", async (request: Request, response: Response) => {
        const machine = findMachine(request, response)
        if (machine === null) return
        response.json(machine)
    })

    app.get("/machines/:nodeId/processvalues", async (request: Request, response: Response) => {
        const machine = findMachine(request, response)
        if (machine === null) return
        response.json({
            NodeId: machine.NodeId ?? null,
            ProcessValues: machine.ProcessValues ?? [],
        })
    })

    app.get("/machines/:nodeId/jobs", async (request: Request, response: Response) => {
        const machine = findMachine(request, response)
        if (machine === null) return
        response.json({
            NodeId: machine.NodeId ?? null,
            Jobs: machine.Jobs ?? [],
            ForeignJobCandidates: machine.ForeignJobCandidates ?? [],
        })
    })

    return app.listen(port, () => {
        console.log(`HTTP Server: listening on http://localhost:${port}`)
    })
}
