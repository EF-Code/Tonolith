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
  `MAX_STEPS_PER_ADVANCE = 1`, below the guide’s 800,000-gas ceiling.

