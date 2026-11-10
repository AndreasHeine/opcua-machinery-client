import { config, log } from "./config";
import { OpcUaDeviceProxyClass } from "./ua-device";
import { startHttpServer } from "./http-server";

const UaDevice = new OpcUaDeviceProxyClass(config.endpoint, config.userIdentity)
const httpServer = startHttpServer(() => UaDevice.summery, config.port)

;(async () => {
    function shutdown() {
        log.info(`OPC UA Client: shutdown requested`)
        UaDevice.disconnect().then(() => {
            httpServer.close(() => {
                log.warn('HTTP Server: shutdown completed')
            })
            log.warn('OPC-UA-Client: shutdown completed')
            process.exit(0)
        })
    }

    try {
        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)
        log.info(`OPC-UA-Client: initializing... endpoint='${config.endpoint}'`)
        await UaDevice.initialize()
    } catch (error: any) {
        log.error(`OPC-UA-Client: error '${(error as Error).name}' message '${(error as Error).message}'`)
        process.exit(-1)
    }
})()

;
[
    "uncaughtException",
    "unhandledRejection"
].forEach(event => {
    process.on(event, (...args: any[]) => {
        log.error(`Something went wrong fix your application :P \n`, args)
        process.exit(1)
    })
})
