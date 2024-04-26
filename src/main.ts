import { OpcUaDeviceClass } from "./ua-device";

const UaDevice = new OpcUaDeviceClass("opc.tcp://opcua.umati.app:4843")

;(async () => {
    function shutdown() {
        UaDevice.disconnect()
        console.warn('OPC-UA-Client: shutting down completed')
        process.exit(0)
    }

    try {
        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)
        console.log('OPC-UA-Client: connecting...')
        await UaDevice.initialize()
    } catch (error: any) {
        console.error(`OPC-UA-Client: error '${(error as Error).name}' message '${(error as Error).message}'`)
        process.exit(-1)
    }
})()

;
[
    "uncaughtException",
    "unhandledRejection"
].forEach(event => {
    process.on(event, (...args: any[]) => {
        console.error(`Something went wrong fix your application :P \n`, args)
        process.exit(1)
    })
})
