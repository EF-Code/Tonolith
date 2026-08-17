import "types"

fun zeroV2RamPage(): Cell<V2RamPage> {
    return V2RamPage { packed: 0 }.toCell();
}

fun zeroV2RamRoot(): Cell<V2RamRoot> {
    val page = zeroV2RamPage();
    return V2RamRoot {
        page0: page,
        page1: page,
        page2: page,
        page3: page,
    }.toCell();
}

fun zeroV2Memory(): Cell<V2Memory> {
    return V2Memory {
        registers: V2Registers { packed: 0 }.toCell(),
        ram: zeroV2RamRoot(),
    }.toCell();
}

fun emptyV2RecordRoot(): cell {
    val page = beginCell().storeUint(0, 3).endCell();
    return beginCell()
        .storeUint(0, 5)
        .storeRef(page)
        .storeRef(page)
        .storeRef(page)
        .storeRef(page)
        .endCell();
}

fun emptyV2Queues(): Cell<V2QueueRoots> {
    val empty = emptyV2RecordRoot();
    return V2QueueRoots {
        inboxRoot: empty,
        outboxRoot: empty,
    }.toCell();
}

fun selectV2RamPage(root: V2RamRoot, index: int): Cell<V2RamPage> {
    if (index == 0) {
        return root.page0;
    }
    if (index == 1) {
        return root.page1;
    }
    if (index == 2) {
        return root.page2;
    }
    if (index == 3) {
        return root.page3;
    }
    throw ErrorsV2.InvalidStorage;
}

fun readV2Register(core: V2CoreState, index: int): uint4 {
    assert (index >= 0 && index < 16) throw ErrorsV2.ArchitecturalInvariant;
    val memory = core.memory.load();
    val registers = memory.registers.load();
    return ((registers.packed >> (index * 4)) & 15) as uint4;
}

fun writeV2Register(mutate core: V2CoreState, index: int, value: uint4) {
    assert (index >= 0 && index < 16) throw ErrorsV2.ArchitecturalInvariant;
    val memory = core.memory.load();
    val registers = memory.registers.load();
    val shift = index * 4;
    val mask = 15 << shift;
    val packed = ((registers.packed & ~mask) | (value << shift)) as uint64;
    val newRegisters = V2Registers { packed }.toCell();
    core.memory = V2Memory {
        registers: newRegisters,
        ram: memory.ram,
    }.toCell();
}

fun readV2Ram(core: V2CoreState, address: int): uint4 {
    assert (address >= 0 && address < 256) throw ErrorsV2.ArchitecturalInvariant;
    val memory = core.memory.load();
    val page = selectV2RamPage(memory.ram.load(), address >> 6).load();
    val shift = (address & 63) * 4;
    return ((page.packed >> shift) & 15) as uint4;
}

fun writeV2Ram(mutate core: V2CoreState, address: int, value: uint4) {
    assert (address >= 0 && address < 256) throw ErrorsV2.ArchitecturalInvariant;
    val memory = core.memory.load();
    val root = memory.ram.load();
    val pageIndex = address >> 6;
    val offset = address & 63;
    val oldPage = selectV2RamPage(root, pageIndex).load();
    val shift = offset * 4;
    val mask = 15 << shift;
    val packed = ((oldPage.packed & ~mask) | (value << shift)) as uint256;
    val newPage = V2RamPage { packed }.toCell();
    var newRoot: Cell<V2RamRoot>;
    if (pageIndex == 0) {
        newRoot = V2RamRoot {
            page0: newPage,
            page1: root.page1,
            page2: root.page2,
            page3: root.page3,
        }.toCell();
    } else if (pageIndex == 1) {
        newRoot = V2RamRoot {
            page0: root.page0,
            page1: newPage,
            page2: root.page2,
            page3: root.page3,
        }.toCell();
    } else if (pageIndex == 2) {
        newRoot = V2RamRoot {
            page0: root.page0,
            page1: root.page1,
            page2: newPage,
            page3: root.page3,
        }.toCell();
    } else {
        newRoot = V2RamRoot {
            page0: root.page0,
            page1: root.page1,
            page2: root.page2,
            page3: newPage,
        }.toCell();
    }
    core.memory = V2Memory {
        registers: memory.registers,
        ram: newRoot,
    }.toCell();
}
