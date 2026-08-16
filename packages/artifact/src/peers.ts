import { Address, beginCell, type Cell } from "@ton/core";
import { DOMAIN, MAX_INPUT_RECORDS } from "../../isa/src/constants.js";

export interface PeerDescriptor {
  readonly coreId: number;
  readonly address: string;
}

export function normalizePeers(peers: readonly PeerDescriptor[]): PeerDescriptor[] {
  if (peers.length > MAX_INPUT_RECORDS) throw new RangeError("v2 peer table supports at most 16 peers");
  const normalized = peers.map((peer) => ({ coreId: peer.coreId, address: Address.parse(peer.address).toRawString() })).sort((a, b) => a.coreId - b.coreId);
  let previous: number | undefined;
  for (const peer of normalized) {
    if (!Number.isInteger(peer.coreId) || peer.coreId < 0 || peer.coreId > 0xffff) throw new RangeError("peer coreId must be 0..65535");
    if (previous === peer.coreId) throw new RangeError(`duplicate peer coreId ${peer.coreId}`);
    previous = peer.coreId;
  }
  return normalized;
}

export function peerCell(peer: PeerDescriptor): Cell {
  const normalized = normalizePeers([peer])[0]!;
  return beginCell()
    .storeUint(DOMAIN.peer, 32)
    .storeUint(normalized.coreId, 16)
    .storeAddress(Address.parse(normalized.address))
    .endCell();
}

export function peerRootCell(peers: readonly PeerDescriptor[]): Cell {
  const normalized = normalizePeers(peers);
  const pages = Array.from({ length: 4 }, (_, pageIndex) => {
    const page = normalized.slice(pageIndex * 4, pageIndex * 4 + 4);
    const builder = beginCell().storeUint(page.length, 3);
    page.forEach((peer) => builder.storeRef(peerCell(peer)));
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

export function peerRoot(peers: readonly PeerDescriptor[]): string {
  return peerRootCell(peers).hash().toString("hex");
}
