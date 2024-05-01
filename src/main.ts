import { OpcUaDeviceClass } from "./ua-device";

const UaDevice = new OpcUaDeviceClass("opc.tcp://opcua.umati.app:4843")
// const UaDevice = new OpcUaDeviceClass("opc.tcp://opcua.umati.app:4840")
// const UaDevice = new OpcUaDeviceClass("opc.tcp://127.0.0.1:4840")

;(async () => {
    function shutdown() {
        console.log(`OPC UA Client: shutdown requested`)
        UaDevice.disconnect().then(() => {
            console.warn('OPC-UA-Client: shutdown completed')
            process.exit(0)
        })
    }

    try {
        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)
        console.log('OPC-UA-Client: initializing...')
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
