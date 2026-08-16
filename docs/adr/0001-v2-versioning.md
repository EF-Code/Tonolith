# ADR 0001: Versioned Tonolith v2 beside v1

## Status

Accepted for implementation.

## Context

Tonolith v1 is a deployed testnet artifact with published ROM, static, code,
StateInit, and state-hash commitments. Changing its storage, ABI, ISA, or hash
preimages would make existing local and public evidence ambiguous.

Tonolith v2 adds asynchronous ports, epochs, bounded queues, reliable delivery,
and measured batching. Those features require new persistent fields and new
message semantics.

## Decision

Implement v2 beside v1 using new versioned namespaces and schemas:

- v1 contracts, tools, tests, artifacts, and evidence remain valid;
- v2 uses `schemaVersion = 2`, `isaVersion = 2`, `abiVersion = 2`, and
  `protocolVersion = 2` in its own implementation surface;
- v2 commitment domains are distinct from v1 domains;
- v1 programs may be used as v2 compatibility fixtures only after independent
  v2 decoding proves identical architectural transitions;
- deployed v1 instances are never migrated in place;
- a v2 program or route change produces a new content-addressed StateInit;
- v2 code has no privileged runtime mutation path.

## Consequences

The repository carries two implementations and two sets of fixtures during the
transition. Shared utilities may be extracted only when bit-for-bit v1 tests
remain passing and the extraction has compatibility vectors.

The v2 verifier must identify the version from code/data commitments rather than
from a human-readable name or an indexer label.

## Release boundary

V2 implementation and testnet work are permitted. Mainnet deployment requires
the separate production gates, external reviews, current network-economics
review, and explicit project-owner approval in the v2 engineering guide.
