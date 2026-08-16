import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ABI_VERSION,
  DOMAIN,
  EVENT_PREFIX,
  ISA_VERSION,
  MESSAGE_PREFIX,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  STATUS,
  STOP_REASON,
  TONOLITH_MAGIC,
} from "../../packages/isa/src/constants.js";

interface ProtocolSpec {
  schemaVersion: number;
  isaVersion: number;
  abiVersion: number;
  protocolVersion: number;
  magic: string;
  domains: Record<string, string>;
  messages: Record<string, string>;
  events: Record<string, string>;
  statuses: Record<string, number>;
  stopReasons: Record<string, number>;
}

test("v2 TypeScript constants match the machine-readable protocol specification", async () => {
  const source = await readFile(new URL("../../spec/v2/protocol.json", import.meta.url), "utf8");
  const spec = JSON.parse(source) as ProtocolSpec;

  assert.equal(spec.schemaVersion, SCHEMA_VERSION);
  assert.equal(spec.isaVersion, ISA_VERSION);
  assert.equal(spec.abiVersion, ABI_VERSION);
  assert.equal(spec.protocolVersion, PROTOCOL_VERSION);
  assert.equal(spec.magic, `0x${TONOLITH_MAGIC.toString(16)}`);
  assert.deepEqual(toHexRecord(DOMAIN), spec.domains);
  assert.deepEqual(toHexRecord(MESSAGE_PREFIX), spec.messages);
  assert.deepEqual(toHexRecord(EVENT_PREFIX), spec.events);
  assert.deepEqual(STATUS, spec.statuses);
  assert.deepEqual(STOP_REASON, spec.stopReasons);
});

test("v2 domains, message prefixes, and events are unique", () => {
  const values = [
    ...Object.values(DOMAIN),
    ...Object.values(MESSAGE_PREFIX),
    ...Object.values(EVENT_PREFIX),
  ];
  assert.equal(new Set(values).size, values.length);
});

function toHexRecord(values: Record<string, number>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, `0x${value.toString(16)}`]),
  );
}
