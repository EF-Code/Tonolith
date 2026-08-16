import { beginCell, type Cell } from "@ton/core";
import { DOMAIN, MAX_INPUT_RECORDS, MAX_PORTS } from "../../isa/src/constants.js";

export interface RouteDescriptor {
  readonly sourceCoreId: number;
  readonly sourcePort: number;
  readonly destinationCoreId: number;
  readonly destinationPort: number;
  readonly delay: number;
  readonly maxRecordsPerEpoch: number;
}

export function normalizeRoutes(routes: readonly RouteDescriptor[]): RouteDescriptor[] {
  if (routes.length > MAX_INPUT_RECORDS) throw new RangeError("v2 route table supports at most 16 routes");
  const sorted = routes.map((route) => ({ ...route })).sort(compareRoutes);
  const seenSources = new Set<string>();
  for (const route of sorted) {
    assertU16(route.sourceCoreId, "sourceCoreId");
    assertU16(route.destinationCoreId, "destinationCoreId");
    assertPort(route.sourcePort, "sourcePort");
    assertPort(route.destinationPort, "destinationPort");
    if (!Number.isInteger(route.delay) || route.delay < 1 || route.delay > 0xff) throw new RangeError("route delay must be 1..255");
    if (!Number.isInteger(route.maxRecordsPerEpoch) || route.maxRecordsPerEpoch < 1 || route.maxRecordsPerEpoch > MAX_INPUT_RECORDS) {
      throw new RangeError("route maxRecordsPerEpoch must be 1..16");
    }
    const source = `${route.sourceCoreId}:${route.sourcePort}`;
    if (seenSources.has(source)) throw new RangeError(`duplicate source route ${source}`);
    seenSources.add(source);
  }
  return sorted;
}

export function routeCell(route: RouteDescriptor): Cell {
  return beginCell()
    .storeUint(DOMAIN.route, 32)
    .storeUint(route.sourceCoreId, 16)
    .storeUint(route.sourcePort, 4)
    .storeUint(route.destinationCoreId, 16)
    .storeUint(route.destinationPort, 4)
    .storeUint(route.delay, 8)
    .storeUint(route.maxRecordsPerEpoch, 8)
    .endCell();
}

export function routeRootCell(routes: readonly RouteDescriptor[]): Cell {
  const normalized = normalizeRoutes(routes);
  const pages = Array.from({ length: 4 }, (_, pageIndex) => {
    const page = normalized.slice(pageIndex * 4, pageIndex * 4 + 4);
    const builder = beginCell().storeUint(page.length, 3);
    page.forEach((route) => builder.storeRef(routeCell(route)));
    return builder.endCell();
  });
  return beginCell()
    .storeUint(normalized.length, 5)
    .storeRef(pages[0]!)
    .storeRef(pages[1]!)
    .storeRef(pages[2]!)
    .storeRef(pages[3]!)
    .endCell();
}

export function routeRoot(routes: readonly RouteDescriptor[]): string {
  return routeRootCell(routes).hash().toString("hex");
}

function compareRoutes(a: RouteDescriptor, b: RouteDescriptor): number {
  return a.sourceCoreId - b.sourceCoreId || a.sourcePort - b.sourcePort || a.destinationCoreId - b.destinationCoreId || a.destinationPort - b.destinationPort;
}

function assertU16(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${field} must be 0..65535`);
}

function assertPort(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_PORTS) throw new RangeError(`${field} must be 0..15`);
}
