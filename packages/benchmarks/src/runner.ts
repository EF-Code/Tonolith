import { buildArtifact, type ArtifactBundle, type BuildArtifactOptions } from "../../artifact/src/manifest.js";
import { acknowledgeOutput, advance, deliverInput, dispatchOutput, step, type V2StepResult } from "../../emulator/src/executor.js";
import { createInitialState, type V2State } from "../../emulator/src/model.js";
import { stateHash } from "../../emulator/src/commitments.js";
import { STATUS } from "../../isa/src/constants.js";
import type { TraceFrame, TraceStateSnapshot } from "../../trace/src/schema.js";

export interface BenchmarkResult {
  readonly name: string;
  readonly evidence: "local-emulator";
  readonly outputs: readonly number[];
  readonly executedInstructions: number;
  readonly finalStateHash: string;
  readonly finalStatus: number;
  readonly frames: readonly TraceFrame[];
}

export interface NetworkBenchmarkResult {
  readonly name: string;
  readonly evidence: "local-emulator";
  readonly deliveredValues: readonly number[];
  readonly sourceStateHash: string;
  readonly destinationStateHash: string;
  readonly sourceInstructions: number;
  readonly destinationInstructions: number;
  readonly acknowledgements: number;
}

export function makeBenchmarkArtifact(source: string, name: string, options: Omit<BuildArtifactOptions, "name"> = {}): ArtifactBundle {
  return buildArtifact(source, {
    ...options,
    name,
    compiler: options.compiler ?? { name: "tonolith-assembler", version: "2.0.0", gitCommit: "e".repeat(40), node: process.version },
  });
}

export function runArtifact(artifact: ArtifactBundle, maxInstructions = 10_000): BenchmarkResult {
  let state = initialState(artifact);
  let executedInstructions = 0;
  const outputs: number[] = [];
  const frames: TraceFrame[] = [];
  while (executedInstructions < maxInstructions && state.status !== STATUS.halted && state.status !== STATUS.faulted) {
    const beforeBatch = state;
    const requestedSteps = Math.min(
      artifact.limits.maxStepsPerAdvance,
      maxInstructions - executedInstructions,
    );
    const batch = advance(state, { rom: artifact.assembly.words }, {
      expectedAdvanceCount: state.advanceCount,
      expectedStateHash: stateHash(state),
      maxInstructions: requestedSteps,
      maxOutputs: artifact.limits.maxOutputsPerAdvance,
    });
    if (batch.executed === 0) break;

    // Reconstruct instruction-level frames independently for the visualizer,
    // while taking the accepted state and protocol counters from Advance.
    let simulation = beforeBatch;
    for (let offset = 0; offset < batch.executed; offset += 1) {
      const before = simulation;
      const result = step(before, { rom: artifact.assembly.words });
      if (!result.executed) break;
      simulation = result.state;
      const after = offset === batch.executed - 1 ? batch.state : simulation;
      if (result.legacyOutput !== undefined) outputs.push(result.legacyOutput.value);
      if (result.output !== undefined) outputs.push(result.output.value);
      frames.push(frame(frames.length, artifact.manifest.coreId, before, after, result));
    }
    state = batch.state;
    executedInstructions += batch.executed;
  }
  return {
    name: artifact.manifest.name,
    evidence: "local-emulator",
    outputs,
    executedInstructions,
    finalStateHash: stateHash(state),
    finalStatus: state.status,
    frames,
  };
}

export function runTwoCorePipeline(sourceArtifact: ArtifactBundle, destinationArtifact: ArtifactBundle, maxTicks = 2_000): NetworkBenchmarkResult {
  let source = initialState(sourceArtifact);
  let destination = initialState(destinationArtifact);
  // The route delay is one logical epoch; start the receiving fixture in the
  // first eligible epoch, matching the on-chain deployment/run configuration.
  destination.epoch = 1n;
  const deliveredValues: number[] = [];
  let sourceInstructions = 0;
  let destinationInstructions = 0;
  let acknowledgements = 0;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (source.status === STATUS.running) {
      const result = step(source, { rom: sourceArtifact.assembly.words });
      source = result.state;
      if (result.executed) {
        sourceInstructions += 1;
        const output = result.output;
        if (output !== undefined) {
          const dispatched = dispatchOutput(source, { expectedStateHash: stateHash(source), outputId: output.outputId });
          const delivered = deliverInput(destination, dispatched.message, source.config.coreId);
          destination = delivered.state;
          source = acknowledgeOutput(source, delivered.acknowledgement, destination.config.coreId).state;
          acknowledgements += 1;
        }
      }
    }
    if (destination.status === STATUS.running) {
      const result = step(destination, { rom: destinationArtifact.assembly.words });
      destination = result.state;
      if (result.executed) {
        destinationInstructions += 1;
        if (result.legacyOutput !== undefined) deliveredValues.push(result.legacyOutput.value);
        if (result.output !== undefined) deliveredValues.push(result.output.value);
      }
    }
    if ((source.status === STATUS.halted || source.status === STATUS.faulted) && (destination.status === STATUS.halted || destination.status === STATUS.faulted)) break;
  }
  return {
    name: `${sourceArtifact.manifest.name}->${destinationArtifact.manifest.name}`,
    evidence: "local-emulator",
    deliveredValues,
    sourceStateHash: stateHash(source),
    destinationStateHash: stateHash(destination),
    sourceInstructions,
    destinationInstructions,
    acknowledgements,
  };
}

function initialState(artifact: ArtifactBundle): V2State {
  const state = createInitialState({
    runId: artifact.manifest.runId,
    coreId: artifact.manifest.coreId,
    programId: artifact.manifest.programId,
    romRoot: artifact.manifest.romRoot,
    initialRamRoot: artifact.manifest.initialRamRoot,
    routeRoot: artifact.manifest.routeRoot,
    staticCommitment: artifact.manifest.staticCommitment,
    routes: artifact.routes,
    requiredInputs: [],
    maxStepsPerAdvance: artifact.limits.maxStepsPerAdvance,
    maxInputRecords: artifact.limits.maxInputRecords,
    maxOutputRecords: artifact.limits.maxOutputRecords,
  });
  state.ram = artifact.assembly.ram.slice();
  return state;
}

function frame(index: number, coreId: number, before: V2State, after: V2State, result: V2StepResult): TraceFrame {
  return {
    index,
    coreId,
    instructionWord: result.word,
    opcode: result.instruction.opcode,
    before: snapshot(before),
    after: snapshot(after),
    phase: result.output === undefined ? "none" : "committed",
    ...(result.output === undefined ? {} : { outputId: result.output.outputId }),
  };
}

function snapshot(state: V2State): TraceStateSnapshot {
  return {
    stateHash: stateHash(state),
    pc: state.pc,
    accumulator: state.accumulator,
    flags: state.flags,
    epoch: state.epoch.toString(),
    instructionCount: state.instructionCount.toString(),
    advanceCount: state.advanceCount.toString(),
    status: state.status,
    outputCommitment: state.outputCommitment,
    inputCommitment: state.inputCommitment,
    inboxCount: state.inbox.length,
    outboxCount: state.outbox.length,
  };
}
