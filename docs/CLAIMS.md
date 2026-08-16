# Evidence and claims boundary

## Proven locally

- The TypeScript assembler emits canonical ISA v1 words for the Fibonacci
  program.
- The TypeScript emulator executes every opcode and the named failure paths.
- The Tolk contract executes one bounded instruction per `Advance` and checks
  stale count/hash commitments before saving state.
- The TypeScript and Tolk ROM root/static commitments agree for the differential
  vector.
- The TypeScript and Tolk core state hashes agree for every differential step.
- Local Tolk Fibonacci emits `1, 1, 2, 3, 5, 8, 13`, reaches HALT after 97
  instructions, and reaches final state hash
  `16925a27b1db66171cebb3d43c74702f06f4a362e302754f24026cca0a6bf2be`.
- The measured worst-case local accepted `Advance` gas is 19,527 gas with
  `MAX_STEPS_PER_ADVANCE = 1`, below the v1 800,000-gas ceiling.

## Proven on TON testnet

- The Fibonacci instance was deployed at
  `kQDCENlXgMC1FOWvEtM2wKcJHBLKS86Tbkv9xkT0u5aIa1av`.
- The recorded account history contains one deployment and 97 accepted
  one-instruction `Advance` transactions.
- The public run emitted `1, 1, 2, 3, 5, 8, 13` and halted at PC 21 after 97
  instructions.
- The final public-run core state hash is
  `16925a27b1db66171cebb3d43c74702f06f4a362e302754f24026cca0a6bf2be`.
- The deployed code, data, ROM root, and static commitment are recorded in the
  [testnet runbook](TESTNET.md) and linked explorer evidence.

## Explicitly unresolved or out of scope

- This is an architectural executor, not gate-level execution.
- It is not Intel 4004-compatible.
- Local emulation is not a TON testnet or mainnet proof.
- No mainnet deployment or production-readiness claim is made.
- The local Acton external-message shim does not execute the contract’s
  `onExternalMessage` hook; the rejection code remains a testnet/runtime gate.
- Security review, economic review, operational keeper design, and a real
  network release review remain production gates.
