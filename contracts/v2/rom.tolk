import "types"

fun zeroV2RomLeaf(): Cell<V2RomLeaf> {
    return V2RomLeaf {
        firstHalf: 0,
        secondHalf: 0,
    }.toCell();
}

fun zeroV2RomLevel1(): Cell<V2RomLevel1> {
    val leaf = zeroV2RomLeaf();
    return V2RomLevel1 {
        leaf0: leaf,
        leaf1: leaf,
        leaf2: leaf,
        leaf3: leaf,
    }.toCell();
}

fun zeroV2RomLevel2(): Cell<V2RomLevel2> {
    val level1 = zeroV2RomLevel1();
    return V2RomLevel2 {
        level10: level1,
        level11: level1,
        level12: level1,
        level13: level1,
    }.toCell();
}

fun zeroV2RomRoot(): Cell<V2RomRoot> {
    val level2 = zeroV2RomLevel2();
    return V2RomRoot {
        level20: level2,
        level21: level2,
        level22: level2,
        level23: level2,
    }.toCell();
}

fun v2RomWithFirstLeaf(firstLeaf: Cell<V2RomLeaf>): Cell<V2RomRoot> {
    val zeroLeaf = zeroV2RomLeaf();
    val firstLevel1 = V2RomLevel1 {
        leaf0: firstLeaf,
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val zeroLevel1 = zeroV2RomLevel1();
    val firstLevel2 = V2RomLevel2 {
        level10: firstLevel1,
        level11: zeroLevel1,
        level12: zeroLevel1,
        level13: zeroLevel1,
    }.toCell();
    val zeroLevel2 = zeroV2RomLevel2();
    return V2RomRoot {
        level20: firstLevel2,
        level21: zeroLevel2,
        level22: zeroLevel2,
        level23: zeroLevel2,
    }.toCell();
}

fun selectV2RomLevel1(level2: V2RomLevel2, index: int): V2RomLevel1 {
    if (index == 0) {
        return level2.level10.load();
    }
    if (index == 1) {
        return level2.level11.load();
    }
    if (index == 2) {
        return level2.level12.load();
    }
    if (index == 3) {
        return level2.level13.load();
    }
    throw ErrorsV2.InvalidStorage;
}

fun v2RomWord(romCell: cell, address: uint10): uint16 {
    val root = (romCell as Cell<V2RomRoot>).load();
    val leafIndex = address >> 5;
    val wordIndex = address & 31;
    val rootIndex = leafIndex >> 4;
    // A 10-bit program counter addresses 32 leaves. The four-way root
    // therefore uses only its first two children, exactly like the v1 ROM
    // layout; the remaining children stay canonical zero padding.
    val level2 = rootIndex == 0 ? root.level20.load() : root.level21.load();
    val level1 = selectV2RomLevel1(level2, (leafIndex >> 2) & 3);
    val leafIndexInLevel = leafIndex & 3;
    var leafCell = level1.leaf0;
    if (leafIndexInLevel == 1) {
        leafCell = level1.leaf1;
    }
    if (leafIndexInLevel == 2) {
        leafCell = level1.leaf2;
    }
    if (leafIndexInLevel == 3) {
        leafCell = level1.leaf3;
    }
    val leaf = leafCell.load();
    if (wordIndex < 16) {
        val shift = (15 - wordIndex) * 16;
        return ((leaf.firstHalf >> shift) & 0xFFFF) as uint16;
    }
    val shift = (31 - wordIndex) * 16;
    return ((leaf.secondHalf >> shift) & 0xFFFF) as uint16;
}
