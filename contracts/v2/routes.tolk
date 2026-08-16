import "queues"
import "types"

fun v2RouteAt(root: cell, index: int): V2Route {
    return (v2RecordAt(root, index) as Cell<V2Route>).load();
}

fun v2FindRoute(routes: cell, sourceCoreId: uint16, sourcePort: int): V2Route? {
    return v2FindRouteFrom(routes, sourceCoreId, sourcePort, 0, v2QueueCount(routes));
}

fun v2FindRouteFrom(
    routes: cell,
    sourceCoreId: uint16,
    sourcePort: int,
    index: int,
    count: int,
): V2Route? {
    if (index >= count || index >= 16) {
        return null;
    }
    val route = v2RouteAt(routes, index);
    if (
        route.domain == DOMAIN_ROUTE_V2 && route.sourceCoreId == sourceCoreId &&
        route.sourcePort == sourcePort
    ) {
        return route;
    }
    return v2FindRouteFrom(routes, sourceCoreId, sourcePort, index + 1, count);
}
