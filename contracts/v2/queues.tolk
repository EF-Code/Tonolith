import "types"

fun v2QueueCount(root: cell): int {
    return root.beginParse().loadUint(5);
}

fun v2QueuePageCount(page: cell): int {
    return page.beginParse().loadUint(3);
}

fun v2EmptyQueuePage(): cell {
    return beginCell().storeUint(0, 3).endCell();
}

fun v2AppendQueuePage(page: cell, record: cell): cell {
    var slice = page.beginParse();
    val count = slice.loadUint(3);
    assert (count < 4) throw ErrorsV2.QueueFull;
    var builder = beginCell().storeUint(count + 1, 3);
    if (count > 0) {
        builder.storeRef(slice.loadRef());
    }
    if (count > 1) {
        builder.storeRef(slice.loadRef());
    }
    if (count > 2) {
        builder.storeRef(slice.loadRef());
    }
    builder.storeRef(record);
    return builder.endCell();
}

fun v2BuildQueueRoot(count: int, page0: cell, page1: cell, page2: cell, page3: cell): cell {
    return beginCell()
        .storeUint(count, 5)
        .storeRef(page0)
        .storeRef(page1)
        .storeRef(page2)
        .storeRef(page3)
        .endCell();
}

fun v2AppendQueueRoot(root: cell, record: cell): cell {
    var slice = root.beginParse();
    val count = slice.loadUint(5);
    assert (count < 16) throw ErrorsV2.QueueFull;
    val page0 = slice.loadRef();
    val page1 = slice.loadRef();
    val page2 = slice.loadRef();
    val page3 = slice.loadRef();
    val pageIndex = count >> 2;
    if (pageIndex == 0) {
        return v2BuildQueueRoot(count + 1, v2AppendQueuePage(page0, record), page1, page2, page3);
    }
    if (pageIndex == 1) {
        return v2BuildQueueRoot(count + 1, page0, v2AppendQueuePage(page1, record), page2, page3);
    }
    if (pageIndex == 2) {
        return v2BuildQueueRoot(count + 1, page0, page1, v2AppendQueuePage(page2, record), page3);
    }
    return v2BuildQueueRoot(count + 1, page0, page1, page2, v2AppendQueuePage(page3, record));
}

fun v2RecordAt(root: cell, index: int): cell {
    var rootSlice = root.beginParse();
    val count = rootSlice.loadUint(5);
    assert (index >= 0 && index < count) throw ErrorsV2.NotFound;
    val page0 = rootSlice.loadRef();
    val page1 = rootSlice.loadRef();
    val page2 = rootSlice.loadRef();
    val page3 = rootSlice.loadRef();
    val pageIndex = index >> 2;
    val offset = index & 3;
    var page = page0;
    if (pageIndex == 1) {
        page = page1;
    }
    if (pageIndex == 2) {
        page = page2;
    }
    if (pageIndex == 3) {
        page = page3;
    }
    var pageSlice = page.beginParse();
    val pageCount = pageSlice.loadUint(3);
    assert (offset >= 0 && offset < pageCount) throw ErrorsV2.NotFound;
    if (offset == 0) {
        return pageSlice.loadRef();
    }
    pageSlice.loadRef();
    if (offset == 1) {
        return pageSlice.loadRef();
    }
    pageSlice.loadRef();
    if (offset == 2) {
        return pageSlice.loadRef();
    }
    pageSlice.loadRef();
    return pageSlice.loadRef();
}

fun v2ReplaceQueuePageRecord(page: cell, offset: int, record: cell): cell {
    var slice = page.beginParse();
    val count = slice.loadUint(3);
    assert (offset >= 0 && offset < count) throw ErrorsV2.NotFound;
    val records0 = offset == 0 ? record : slice.loadRef();
    val records1 = count > 1 ? (offset == 1 ? record : slice.loadRef()) : null;
    val records2 = count > 2 ? (offset == 2 ? record : slice.loadRef()) : null;
    val records3 = count > 3 ? (offset == 3 ? record : slice.loadRef()) : null;
    var builder = beginCell().storeUint(count, 3).storeRef(records0);
    if (records1 != null) {
        builder.storeRef(records1!);
    }
    if (records2 != null) {
        builder.storeRef(records2!);
    }
    if (records3 != null) {
        builder.storeRef(records3!);
    }
    return builder.endCell();
}

fun v2ReplaceRecordAt(root: cell, index: int, record: cell): cell {
    var rootSlice = root.beginParse();
    val count = rootSlice.loadUint(5);
    assert (index >= 0 && index < count) throw ErrorsV2.NotFound;
    val page0 = rootSlice.loadRef();
    val page1 = rootSlice.loadRef();
    val page2 = rootSlice.loadRef();
    val page3 = rootSlice.loadRef();
    val pageIndex = index >> 2;
    val offset = index & 3;
    if (pageIndex == 0) {
        return v2BuildQueueRoot(
            count,
            v2ReplaceQueuePageRecord(page0, offset, record),
            page1,
            page2,
            page3,
        );
    }
    if (pageIndex == 1) {
        return v2BuildQueueRoot(
            count,
            page0,
            v2ReplaceQueuePageRecord(page1, offset, record),
            page2,
            page3,
        );
    }
    if (pageIndex == 2) {
        return v2BuildQueueRoot(
            count,
            page0,
            page1,
            v2ReplaceQueuePageRecord(page2, offset, record),
            page3,
        );
    }
    return v2BuildQueueRoot(
        count,
        page0,
        page1,
        page2,
        v2ReplaceQueuePageRecord(page3, offset, record),
    );
}

fun v2OutputAt(root: cell, index: int): V2OutputRecord {
    return (v2RecordAt(root, index) as Cell<V2OutputRecord>).load();
}

fun v2InputAt(root: cell, index: int): V2InputRecord {
    return (v2RecordAt(root, index) as Cell<V2InputRecord>).load();
}

fun v2FindInput(root: cell, epoch: uint64, port: int): V2InputCursor {
    val count = v2QueueCount(root);
    return v2FindInputFrom(root, epoch, port, 0, count);
}

fun v2FindInputFrom(root: cell, epoch: uint64, port: int, index: int, count: int): V2InputCursor {
    if (index >= count || index >= 16) {
        return V2InputCursor {
            found: 0,
            index: 0,
            value: 0,
        };
    }
    val input = v2InputAt(root, index);
    if (input.destinationEpoch == epoch && input.destinationPort == port && input.consumed == 0) {
        return V2InputCursor {
            found: 1,
            index: index as uint8,
            value: input.value,
        };
    }
    return v2FindInputFrom(root, epoch, port, index + 1, count);
}
