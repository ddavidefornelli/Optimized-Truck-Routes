# Architecture and algorithm notes

This document describes the currently implemented starter version, not a claim that all items in the linked product specification have shipped.

## Request path

1. FastAPI validates coordinates, profile names, preferences and timestamps with Pydantic. Extra input such as a client-supplied `vehicle` object is rejected.
2. The backend resolves the server-side truck profile from a versioned JSON asset.
3. A request snaps each coordinate to the nearest loaded road node within a configurable radius. The response includes both the requested and snapped coordinates and the offset.
4. The engine creates a filtered directed multigraph for each requested route profile. Known closures, known access bans and known dimensional limits are hard constraints; user-selected `exclude` preferences are also applied as hard constraints.
5. Dijkstra calculates each route with a non-negative weight. Parallel directed edges are supported. Equivalent edge sequences are merged and the profiles associated with them are returned together.
6. A route summary reports distance, estimated duration, cost components, attribute coverage, known surface/width/lighting gaps and explanatory comparisons.

## Cost model

The versioned file `backend/src/truck_routes/assets/routing_weights.json` defines profile weights and non-negative penalty coefficients. The generalized cost follows the specification's structure:

`w_time × estimated_seconds + w_distance × distance_m / reference_speed + distance_m × sum(k_i × severity_i) + uncertainty/documented-event penalties`

Every known severity is clamped to `[0, 1]`. Unknown is represented independently from a severity of zero. The `shortest` profile minimizes distance among edges that pass hard constraints; `balanced` and `road_comfort` apply the configured soft penalties. Coefficients are experimental and not certified safety thresholds.

## Supabase integration

Supabase is used as PostgreSQL plus PostGIS, accessed by the backend through `SUPABASE_DB_URL`. Do not use a database password or service secret in frontend JavaScript. Migrations define provenance, graph snapshots, directional road edges, restrictions, turn rules and dynamic observations. At startup, the adapter loads the active graph snapshot into NetworkX; route requests do not trigger dataset downloads.

The current adapter supports a static active graph snapshot. It does not yet ingest Finnish source datasets, load dynamic observations, or apply `turn_rule` transitions. Import tooling and schema mappings must be completed and tested against an actual, licensed source release before changing to `ROAD_DATA_MODE=supabase`.

## Geographic reference systems

- Persisted metric geometry: EPSG:3067.
- API coordinates and GeoJSON: EPSG:4326, coordinate order `[longitude, latitude]`.
- Routing uses directed edges. Importers must retain bridge/tunnel levels and must not create connections solely because lines cross in 2D.

## Deliberate limits

- The demo graph is synthetic and only tests algorithm behaviour.
- The configured truck dimensions are placeholders and unvalidated.
- The current snap-to-node approach is an MVP simplification; it is not edge snapping with virtual nodes.
- Turn bans are not implemented in the active routing graph yet.
- Traffic observations, temporary feed closures and a time-dependent routing model are not integrated.
- Tight-curve severity is only a proxy. Blind-curve detection is not implemented.
- An urban severity attribute is a proxy, not an authoritative city-centre polygon.
- The solar model approximates darkness using whether the sun is below the horizon at the requested departure time; it does not recalculate time-dependent darkness on every edge.
- This tool must not present a result as safe, certified or legally transit-authorized.
