import express, { Request, Response } from "express"
import { Server } from "http"

export type OutputData = {
    Server?: unknown
    Machines?: MachineSummary[]
}

type MachineSummary = {
    Identification?: {
        ProductInstanceUri?: string | null
    }
}

export function startHttpServer(getData: () => OutputData, port = 3000): Server {
    const app = express()

    app.get("/server", async (_request: Request, response: Response) => {
        try {
            const data = getData()
            response.json(data.Server ?? null)
        } catch (error) {
            response.status(500).json({ error: `Unable to read OPC UA summary: ${(error as Error).message}` })
        }
    })

    app.get("/machines", async (request: Request, response: Response) => {
        try {
            const data = getData()
            const machines = Array.isArray(data.Machines) ? data.Machines : []
            const productInstanceUri = `${request.query.productInstanceUri ?? ""}`.trim()

            if (productInstanceUri.length === 0) {
                response.json(machines)
                return
            }

            response.json(
                machines.filter((machine) => machine.Identification?.ProductInstanceUri === productInstanceUri)
            )
        } catch (error) {
            response.status(500).json({ error: `Unable to read OPC UA summary: ${(error as Error).message}` })
        }
    })

    return app.listen(port, () => {
        console.log(`HTTP Server: listening on http://localhost:${port}`)
    })
}