# Tonolith v2 threat model

This document describes the security boundary of the v2 architectural
processor, its asynchronous core-to-core protocol, and the off-chain tooling.
Tonolith is a deterministic processor state machine; it is not transistor-level
or gate-level execution and it does not claim Intel 4004 compatibility.

## Assets

- The deployed code and immutable StateInit identity.
- Program, ROM, RAM, route, peer, limits, and static commitments.
- The accepted state-hash chain, logical epochs, counters, and queue contents.
- Reliable output delivery, acknowledgements, deduplication, and bounded funds.
- The independence and reproducibility of the emulator, verifier, artifacts, and
  visualizer traces.
- Keeper wallet funds and credentials held outside the repository.

## Trust boundaries

1. The immutable v2 contract is the consensus object. It does not trust a
   keeper, emulator, assembler, RPC index, or visualizer.
2. A keeper is an untrusted liveness agent. Any keeper can submit a bounded
   request, but it cannot authorize state mutation or change static data.
3. A peer address is authenticated by the immutable peer table and is not a
   keeper allowlist.
4. The verifier treats raw BOCs and transaction history as evidence. Indexed
   decoded fields are advisory and cannot replace body or StateInit checks.
5. The browser visualizer consumes verifier output and labels reconstructed
   fields separately from chain facts.
6. Wallet signing and RPC credentials are external operational dependencies.

## Adversaries

- A stale or racing keeper submitting an old state hash or counter.
- A malicious sender impersonating a core, replaying an output, or mutating a
  delivery field while retaining an output ID.
- A provider returning incomplete, reordered, divergent, or fabricated history.
- A poisoned artifact, source map, route table, or deployment manifest.
- A malformed cell designed to trigger parser ambiguity, excessive depth, a
  dictionary failure, an action-phase failure, or a queue overflow.
- A compromised keeper host attempting to leak signing material or overspend.
- A visualizer or API incorrectly presenting a dispatch as destination receipt
  or finality.

## Primary controls

| Threat | Control | Evidence target |
| --- | --- | --- |
| stale/racing advance | expected counter + exact state hash; no privileged keeper | Acton stale and two-keeper tests |
| forged delivery | immutable run/route/peer checks and authenticated sender | first-delivery, wrong-peer, and conflict tests |
| replay | output ID binding, destination slot uniqueness, exact duplicate ACK | duplicate and conflicting-replay tests |
| lost output | pending outbox remains until authenticated ACK; bounce does not erase it | retry/bounce tests |
| queue exhaustion | fixed queue bounds and explicit backpressure | full-queue tests |
| epoch confusion | route delay, epoch window, sequence and quota checks | stale-epoch tests |
| artifact substitution | canonical files and recomputed commitments | artifact tamper tests |
| StateInit substitution | code/data/StateInit/address recomputation | SDK and raw verifier tests |
| provider disagreement | two-source fingerprint and continuity comparison | verifier disagreement test |
| secret leakage | external wallet interface, read-only keeper mode, staged secret scan | release preflight |
| false visual claims | explicit message phases and evidence class in trace schema | trace validation and UI integration |

## Invariants

- No external message changes state.
- No keeper identity occurs in static commitments or authorization rules.
- A stale request cannot mutate architectural or protocol state.
- An output remains retryable until its matching authenticated acknowledgement.
- An exact duplicate delivery is idempotent; a conflicting duplicate fails.
- A route, peer, epoch, sequence, and output ID are jointly consistent.
- A bounded request cannot create an unbounded queue, action list, cell graph, or
  message body.
- A verifier never returns `verified` when history, code, StateInit, BOCs, or
  commitment comparisons are incomplete.
- Local emulator and Acton evidence are not described as testnet or mainnet
  evidence.

## Residual risks and release gates

The design still requires local-validator evidence for action rollback, bounce
semantics, and final balance reconciliation; public testnet evidence for real
inclusion, finality, fees, and independent keepers; and external review before
any production or mainnet claim. A verifier/provider outage is an incomplete
result, not permission to skip history. A keeper wallet compromise can still
burn its own funds and must be contained by external spend limits.
