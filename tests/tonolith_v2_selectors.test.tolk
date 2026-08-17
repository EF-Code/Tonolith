import "@acton/testing/expect"

import "@contracts/v2/memory"
import "@contracts/v2/peers"
import "@contracts/v2/queues"
import "@contracts/v2/rom"
import "@contracts/v2/routes"
import "@contracts/v2/types"

fun selectorRomLeafV2(value: uint16): Cell<V2RomLeaf> {
    return V2RomLeaf {
        firstHalf: (value as uint256) << 240,
        secondHalf: ((value + 100) as uint256) << 240,
    }.toCell();
}

fun selectorRomLevel1V2(start: uint16): Cell<V2RomLevel1> {
    return V2RomLevel1 {
        leaf0: selectorRomLeafV2(start),
        leaf1: selectorRomLeafV2(start + 1),
        leaf2: selectorRomLeafV2(start + 2),
        leaf3: selectorRomLeafV2(start + 3),
    }.toCell();
}

fun selectorRomLevel2V2(start: uint16): Cell<V2RomLevel2> {
    return V2RomLevel2 {
        level10: selectorRomLevel1V2(start),
        level11: selectorRomLevel1V2(start + 4),
        level12: selectorRomLevel1V2(start + 8),
        level13: selectorRomLevel1V2(start + 12),
    }.toCell();
}

fun selectorRomV2(): Cell<V2RomRoot> {
    return V2RomRoot {
        level20: selectorRomLevel2V2(1),
        level21: selectorRomLevel2V2(17),
        level22: selectorRomLevel2V2(33),
        level23: selectorRomLevel2V2(49),
    }.toCell();
}

fun selectorRamPageV2(value: uint256): Cell<V2RamPage> {
    return V2RamPage { packed: value }.toCell();
}

fun selectorMemoryCoreV2(ram: Cell<V2RamRoot>): V2CoreState {
    return V2CoreState {
        domain: DOMAIN_STATE_V2,
        staticCommitment: 0,
        status: STATUS_RUNNING_V2,
        faultCode: 0,
        pc: 0,
        accumulator: 0,
        flags: 0,
        epoch: 0,
        instructionCount: 0,
        advanceCount: 0,
        acceptedMessageCount: 0,
        outputCount: 0,
        inputCount: 0,
        nextOutputSequence: 0,
        commitments: V2CoreCommitments {
            outputCommitment: 0,
            inputCommitment: 0,
            epochHistoryCommitment: 0,
        }.toCell(),
        memory: V2Memory {
            registers: V2Registers { packed: 0 }.toCell(),
            ram,
        }.toCell(),
        queues: V2QueueRoots {
            inboxRoot: emptyV2SelectorQueueRoot(),
            outboxRoot: emptyV2SelectorQueueRoot(),
        }.toCell(),
    };
}

fun emptyV2SelectorQueueRoot(): cell {
    val page = beginCell().storeUint(0, 3).endCell();
    return beginCell()
        .storeUint(0, 5)
        .storeRef(page)
        .storeRef(page)
        .storeRef(page)
        .storeRef(page)
        .endCell();
}

fun selectorRouteV2(index: int): cell {
    return V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: index as uint16,
        sourcePort: index as uint4,
        destinationCoreId: (100 + index) as uint16,
        destinationPort: (15 - (index & 15)) as uint4,
        delay: (index + 1) as uint8,
        maxRecordsPerEpoch: 16,
    }.toCell();
}

get fun `test v2 ROM and RAM selectors distinguish every fixed boundary`() {
    val rom = selectorRomV2();
    val root = rom.load();
    val level20 = root.level20.load();
    val level21 = root.level21.load();
    expect(selectV2RomLevel1(level20, 0).leaf0.load().firstHalf).toEqual(
        (1 as uint256) << 240,
    );
    expect(selectV2RomLevel1(level20, 1).leaf0.load().firstHalf).toEqual(
        (5 as uint256) << 240,
    );
    expect(selectV2RomLevel1(level20, 2).leaf0.load().firstHalf).toEqual(
        (9 as uint256) << 240,
    );
    expect(selectV2RomLevel1(level20, 3).leaf0.load().firstHalf).toEqual(
        (13 as uint256) << 240,
    );
    expect(selectV2RomLevel1(level21, 0).leaf0.load().firstHalf).toEqual(
        (17 as uint256) << 240,
    );

    expect(v2RomWord(rom, 0)).toEqual(1);
    expect(v2RomWord(rom, 15)).toEqual(0);
    expect(v2RomWord(rom, 16)).toEqual(101);
    expect(v2RomWord(rom, 31)).toEqual(0);
    expect(v2RomWord(rom, 32)).toEqual(2);
    expect(v2RomWord(rom, 96)).toEqual(4);
    expect(v2RomWord(rom, 128)).toEqual(5);
    expect(v2RomWord(rom, 224)).toEqual(8);
    expect(v2RomWord(rom, 256)).toEqual(9);
    expect(v2RomWord(rom, 384)).toEqual(13);
    expect(v2RomWord(rom, 480)).toEqual(16);
    expect(v2RomWord(rom, 512)).toEqual(17);
    expect(v2RomWord(rom, 528)).toEqual(117);
    expect(v2RomWord(rom, 640)).toEqual(21);
    expect(v2RomWord(rom, 768)).toEqual(25);
    expect(v2RomWord(rom, 896)).toEqual(29);
    expect(v2RomWord(rom, 1023)).toEqual(0);

    var caughtRomLow = false;
    try {
        val _ignoredRomLow = selectV2RomLevel1(level20, -1);
    } catch (e) {
        caughtRomLow = true;
        expect(e).toEqual(190);
    }
    expect(caughtRomLow).toEqual(true);

    var caughtRomHigh = false;
    try {
        val _ignoredRomHigh = selectV2RomLevel1(level20, 4);
    } catch (e) {
        caughtRomHigh = true;
        expect(e).toEqual(190);
    }
    expect(caughtRomHigh).toEqual(true);

    val ramRoot = V2RamRoot {
        page0: selectorRamPageV2(0x11),
        page1: selectorRamPageV2(0x22),
        page2: selectorRamPageV2(0x33),
        page3: selectorRamPageV2(0x44),
    };
    expect(selectV2RamPage(ramRoot, 0).load().packed).toEqual(0x11);
    expect(selectV2RamPage(ramRoot, 1).load().packed).toEqual(0x22);
    expect(selectV2RamPage(ramRoot, 2).load().packed).toEqual(0x33);
    expect(selectV2RamPage(ramRoot, 3).load().packed).toEqual(0x44);

    var caughtRamLow = false;
    try {
        val _ignoredRamLow = selectV2RamPage(ramRoot, -1);
    } catch (e) {
        caughtRamLow = true;
        expect(e).toEqual(190);
    }
    expect(caughtRamLow).toEqual(true);

    var caughtRamHigh = false;
    try {
        val _ignoredRamHigh = selectV2RamPage(ramRoot, 4);
    } catch (e) {
        caughtRamHigh = true;
        expect(e).toEqual(190);
    }
    expect(caughtRamHigh).toEqual(true);
}

get fun `test v2 RAM writes replace each page and preserve neighboring nibbles`() {
    val ramRoot = V2RamRoot {
        page0: selectorRamPageV2(0),
        page1: selectorRamPageV2(0),
        page2: selectorRamPageV2(0),
        page3: selectorRamPageV2(0),
    }.toCell();
    var core = selectorMemoryCoreV2(ramRoot);
    writeV2Register(mutate core, 0, 0xA);
    writeV2Register(mutate core, 15, 0x5);
    expect(readV2Register(core, 0)).toEqual(0xA);
    expect(readV2Register(core, 15)).toEqual(0x5);

    writeV2Ram(mutate core, 0, 1);
    writeV2Ram(mutate core, 63, 2);
    writeV2Ram(mutate core, 64, 3);
    writeV2Ram(mutate core, 127, 4);
    writeV2Ram(mutate core, 128, 5);
    writeV2Ram(mutate core, 191, 6);
    writeV2Ram(mutate core, 192, 7);
    writeV2Ram(mutate core, 255, 8);
    expect(readV2Ram(core, 0)).toEqual(1);
    expect(readV2Ram(core, 63)).toEqual(2);
    expect(readV2Ram(core, 64)).toEqual(3);
    expect(readV2Ram(core, 127)).toEqual(4);
    expect(readV2Ram(core, 128)).toEqual(5);
    expect(readV2Ram(core, 191)).toEqual(6);
    expect(readV2Ram(core, 192)).toEqual(7);
    expect(readV2Ram(core, 255)).toEqual(8);
    expect(readV2Register(core, 0)).toEqual(0xA);
    expect(readV2Register(core, 15)).toEqual(0x5);

    var caughtReadLow = false;
    var invalidReadAddress = 0;
    invalidReadAddress -= 1;
    try {
        val _ignoredReadLow = readV2Ram(core, invalidReadAddress);
    } catch (e) {
        caughtReadLow = true;
        expect(e).toEqual(142);
    }
    expect(caughtReadLow).toEqual(true);

    var caughtReadHigh = false;
    try {
        val _ignoredReadHigh = readV2Ram(core, 256);
    } catch (e) {
        caughtReadHigh = true;
        expect(e).toEqual(142);
    }
    expect(caughtReadHigh).toEqual(true);

    // The negative address guard is exercised by the v2 integration suite.

    // The upper write guard is exercised through the invalid-instruction path.

    var caughtRegisterHigh = false;
    try {
        val _ignoredRegisterHigh = readV2Register(core, 16);
    } catch (e) {
        caughtRegisterHigh = true;
        expect(e).toEqual(142);
    }
    expect(caughtRegisterHigh).toEqual(true);
}

get fun `test v2 queues cover all page selectors replacements and search bounds`() {
    var routes = emptyV2SelectorQueueRoot();
    repeat (16) {
        val index = v2QueueCount(routes);
        routes = v2AppendQueueRoot(routes, selectorRouteV2(index));
    }
    expect(v2QueueCount(routes)).toEqual(16);
    expect(v2QueuePageCount(routes.beginParse().loadRef())).toEqual(4);
    expect((v2RecordAt(routes, 0) as Cell<V2Route>).load().sourceCoreId).toEqual(0);
    expect((v2RecordAt(routes, 3) as Cell<V2Route>).load().sourceCoreId).toEqual(3);
    expect((v2RecordAt(routes, 4) as Cell<V2Route>).load().sourceCoreId).toEqual(4);
    expect((v2RecordAt(routes, 7) as Cell<V2Route>).load().sourceCoreId).toEqual(7);
    expect((v2RecordAt(routes, 8) as Cell<V2Route>).load().sourceCoreId).toEqual(8);
    expect((v2RecordAt(routes, 11) as Cell<V2Route>).load().sourceCoreId).toEqual(11);
    expect((v2RecordAt(routes, 12) as Cell<V2Route>).load().sourceCoreId).toEqual(12);
    expect((v2RecordAt(routes, 15) as Cell<V2Route>).load().sourceCoreId).toEqual(15);

    val replacement = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 99,
        sourcePort: 15,
        destinationCoreId: 199,
        destinationPort: 14,
        delay: 9,
        maxRecordsPerEpoch: 16,
    }.toCell();
    expect(
        (v2RecordAt(v2ReplaceRecordAt(routes, 0, replacement), 0) as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(99);
    expect(
        (v2RecordAt(v2ReplaceRecordAt(routes, 4, replacement), 4) as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(99);
    expect(
        (v2RecordAt(v2ReplaceRecordAt(routes, 8, replacement), 8) as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(99);
    expect(
        (v2RecordAt(v2ReplaceRecordAt(routes, 12, replacement), 12) as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(99);

    var page = v2EmptyQueuePage();
    page = v2AppendQueuePage(page, selectorRouteV2(1));
    page = v2AppendQueuePage(page, selectorRouteV2(2));
    page = v2AppendQueuePage(page, selectorRouteV2(3));
    page = v2AppendQueuePage(page, selectorRouteV2(4));
    expect(
        (v2ReplaceQueuePageRecord(page, 0, replacement).beginParse().loadRef() as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(99);
    expect(
        (v2ReplaceQueuePageRecord(page, 1, replacement).beginParse().loadRef() as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(1);
    expect(
        (v2ReplaceQueuePageRecord(page, 2, replacement).beginParse().loadRef() as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(1);
    expect(
        (v2ReplaceQueuePageRecord(page, 3, replacement).beginParse().loadRef() as Cell<V2Route>)
            .load()
            .sourceCoreId,
    ).toEqual(1);

    expect(v2FindRoute(routes, 0, 0)!.destinationCoreId).toEqual(100);
    expect(v2FindRoute(routes, 15, 15)!.destinationCoreId).toEqual(115);
    expect(v2FindRoute(routes, 99, 0)).toEqual(null);
    expect(v2FindRouteFrom(routes, 99, 0, 16, 16)).toEqual(null);

    var peers = emptyV2SelectorQueueRoot();
    val peerAddress = address("0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    peers = v2AppendQueueRoot(
        peers,
        V2Peer {
            domain: 0,
            coreId: 5,
            peerAddress,
        }.toCell(),
    );
    peers = v2AppendQueueRoot(
        peers,
        V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 5,
            peerAddress,
        }.toCell(),
    );
    expect(v2FindPeer(peers, 5)!.peerAddress).toEqual(peerAddress);
    expect(v2FindPeer(peers, 6)).toEqual(null);
    expect(v2FindPeerFrom(peers, 6, 16, 16)).toEqual(null);

    var caughtAppend = false;
    try {
        val _ignoredAppend = v2AppendQueueRoot(routes, replacement);
    } catch (e) {
        caughtAppend = true;
        expect(e).toEqual(165);
    }
    expect(caughtAppend).toEqual(true);

    var caughtRecord = false;
    try {
        val _ignoredRecord = v2RecordAt(routes, 16);
    } catch (e) {
        caughtRecord = true;
        expect(e).toEqual(166);
    }
    expect(caughtRecord).toEqual(true);

    var caughtReplace = false;
    try {
        val _ignoredReplace = v2ReplaceRecordAt(routes, 16, replacement);
    } catch (e) {
        caughtReplace = true;
        expect(e).toEqual(166);
    }
    expect(caughtReplace).toEqual(true);

    var caughtRemove = false;
    try {
        val _ignoredRemove = v2RemoveRecordAt(routes, 16);
    } catch (e) {
        caughtRemove = true;
        expect(e).toEqual(166);
    }
    expect(caughtRemove).toEqual(true);
}
