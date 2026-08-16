import assert from "node:assert/strict";
import test from "node:test";
import { romRoot, romRootCell, ramRoot, ramRootCell } from "../../packages/artifact/src/memory.js";
import { routeRoot, routeRootCell } from "../../packages/artifact/src/routes.js";
import { ramRootCell as emulatorRamRootCell, routeRoot as emulatorRouteRoot } from "../../packages/emulator/src/commitments.js";

test("v2 ROM and RAM trees are fixed-size, zero-filled, and deterministic", () => {
  const emptyRom = romRoot();
  assert.equal(emptyRom, romRoot([]));
  assert.notEqual(emptyRom, romRoot([1]));
  assert.notEqual(romRoot([0x1234]), romRoot([0x1235]));
  assert.equal(romRootCell([0x1234]).hash().toString("hex"), romRoot([0x1234]));

  const emptyRam = ramRoot();
  const ram = new Uint8Array(256);
  ram[0] = 0xa;
  ram[255] = 0xb;
  assert.equal(ramRootCell(ram).hash().toString("hex"), ramRoot(ram));
  assert.notEqual(emptyRam, ramRoot(ram));
  assert.equal(emulatorRamRootCell(ram).hash().toString("hex"), ramRoot(ram));
});

test("route roots sort descriptors and reject ambiguous source ports", () => {
  const routes = [
    { sourceCoreId: 1, sourcePort: 2, destinationCoreId: 3, destinationPort: 4, delay: 2, maxRecordsPerEpoch: 4 },
    { sourceCoreId: 0, sourcePort: 1, destinationCoreId: 2, destinationPort: 3, delay: 1, maxRecordsPerEpoch: 4 },
  ];
  const reversed = [...routes].reverse();
  assert.equal(routeRoot(routes), routeRoot(reversed));
  assert.equal(routeRootCell(routes).hash().toString("hex"), routeRoot(routes));
  assert.equal(emulatorRouteRoot(routes), routeRoot(routes));
  assert.throws(() => routeRoot([...routes, { ...routes[0]! }]), /duplicate source route/);
  assert.throws(() => routeRoot([{ ...routes[0]!, delay: 0 }]), /route delay/);
});
