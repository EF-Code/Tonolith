import "queues"
import "types"

const DOMAIN_PEER_V2: uint32 = 0x544C5033

fun v2PeerAt(root: cell, index: int): V2Peer {
    return (v2RecordAt(root, index) as Cell<V2Peer>).load();
}

fun v2FindPeer(peers: cell, coreId: uint16): V2Peer? {
    return v2FindPeerFrom(peers, coreId, 0, v2QueueCount(peers));
}

fun v2FindPeerFrom(peers: cell, coreId: uint16, index: int, count: int): V2Peer? {
    if (index >= count || index >= 16) {
        return null;
    }
    val peer = v2PeerAt(peers, index);
    if (peer.domain == DOMAIN_PEER_V2 && peer.coreId == coreId) {
        return peer;
    }
    return v2FindPeerFrom(peers, coreId, index + 1, count);
}
