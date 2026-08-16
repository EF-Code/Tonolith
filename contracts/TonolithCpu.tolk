import "types"

const MIN_ADVANCE_VALUE: coins = ton("0.01")
const STORAGE_RESERVE: coins = ton("0.1")

contract TonolithCpu {
    author: "ef-code"
    version: "0.1.0"
    description: "Tonolith v1 deterministic 4-bit processor"
    storage: Storage
    incomingMessages: AllowedMessage
    incomingExternal: slice
    emittedEvents: CpuAdvanced | CpuOutput
    thrownErrors: Errors
}

fun emitAdvanced(event: CpuAdvanced) {
    val message = createExternalLogMessage({
        dest: createAddressNone(),
        body: event,
    });
    message.send(SEND_MODE_REGULAR);
}

fun emitOutput(event: CpuOutput?) {
    if (event != null) {
        val message = createExternalLogMessage({
            dest: createAddressNone(),
            body: event,
        });
        message.send(SEND_MODE_REGULAR);
    }
}

