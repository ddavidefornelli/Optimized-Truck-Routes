"""Direct PostgreSQL/PostGIS adapter for a Supabase project.

The Supabase project's database connection string is used only server-side.
The adapter expects road segments to be imported before the API starts; a route
request never downloads or imports road datasets.
"""

from __future__ import annotations

import json
from typing import Any

import networkx as nx


class ActiveGraphNotFound(RuntimeError):
    """No validated active graph snapshot is available in Supabase."""


SNAPSHOT_SQL = """
SELECT id::text AS id, version, coverage_area, model_version, built_at
FROM public.graph_snapshot
WHERE status = 'active'
ORDER BY built_at DESC
LIMIT 1
"""

EDGE_SQL = """
SELECT
    e.id::text AS id,
    e.from_node_id::text AS from_node_id,
    e.to_node_id::text AS to_node_id,
    e.length_m,
    e.speed_limit_kmh,
    e.surface,
    e.surface_status,
    e.width_m,
    e.width_status,
    e.illuminated,
    e.lighting_status,
    e.urban_severity,
    e.curve_severity,
    e.hazard_severity,
    e.hazard_status,
    e.restriction_status,
    e.closure_status,
    e.truck_access,
    e.max_vehicle_height_m,
    e.max_vehicle_width_m,
    e.max_vehicle_length_m,
    e.max_vehicle_weight_kg,
    e.closed,
    extensions.ST_X(extensions.ST_Transform(n_from.geom, 4326)) AS from_longitude,
    extensions.ST_Y(extensions.ST_Transform(n_from.geom, 4326)) AS from_latitude,
    extensions.ST_X(extensions.ST_Transform(n_to.geom, 4326)) AS to_longitude,
    extensions.ST_Y(extensions.ST_Transform(n_to.geom, 4326)) AS to_latitude,
    extensions.ST_AsGeoJSON(extensions.ST_Transform(e.geom, 4326))::jsonb AS geometry_geojson
FROM public.road_edge AS e
JOIN public.road_node AS n_from ON n_from.id = e.from_node_id
JOIN public.road_node AS n_to ON n_to.id = e.to_node_id
WHERE e.snapshot_id = %s
ORDER BY e.id
"""


class SupabaseGraphStore:
    """Loads an active, prebuilt snapshot into a directed in-memory graph."""

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def load_graph(self) -> dict[str, Any]:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(
            self.database_url,
            connect_timeout=8,
            row_factory=dict_row,
        ) as connection:
            snapshot = connection.execute(SNAPSHOT_SQL).fetchone()
            if snapshot is None:
                raise ActiveGraphNotFound(
                    "Nessuno snapshot attivo trovato. Importa e valida prima un grafo stradale."
                )
            graph = nx.MultiDiGraph()
            rows = connection.execute(EDGE_SQL, (snapshot["id"],)).fetchall()

        for row in rows:
            from_id = str(row["from_node_id"])
            to_id = str(row["to_node_id"])
            from_lon = float(row["from_longitude"])
            from_lat = float(row["from_latitude"])
            to_lon = float(row["to_longitude"])
            to_lat = float(row["to_latitude"])
            graph.add_node(from_id, longitude=from_lon, latitude=from_lat, level=0)
            graph.add_node(to_id, longitude=to_lon, latitude=to_lat, level=0)

            geometry_json = row.get("geometry_geojson")
            if isinstance(geometry_json, str):
                geometry_json = json.loads(geometry_json)
            if geometry_json and geometry_json.get("type") == "LineString":
                coordinates = geometry_json.get("coordinates", [])
            else:
                coordinates = [[from_lon, from_lat], [to_lon, to_lat]]

            edge_attributes = {
                "id": str(row["id"]),
                "geometry": coordinates,
                "length_m": float(row["length_m"]),
                "speed_limit_kmh": row["speed_limit_kmh"],
                "surface": row["surface"],
                "surface_status": row["surface_status"] or "unknown",
                "width_m": row["width_m"],
                "width_status": row["width_status"] or "unknown",
                "illuminated": row["illuminated"],
                "lighting_status": row["lighting_status"] or "unknown",
                "urban_severity": row["urban_severity"],
                "curve_severity": row["curve_severity"],
                "hazard_severity": row["hazard_severity"],
                "hazard_status": row["hazard_status"] or "unknown",
                "restriction_status": row["restriction_status"] or "unknown",
                "closure_status": row["closure_status"] or "unknown",
                "truck_access": row["truck_access"] or "unknown",
                "max_vehicle_height_m": row["max_vehicle_height_m"],
                "max_vehicle_width_m": row["max_vehicle_width_m"],
                "max_vehicle_length_m": row["max_vehicle_length_m"],
                "max_vehicle_weight_kg": row["max_vehicle_weight_kg"],
                "closed": bool(row["closed"]),
                # Dynamic traffic is deliberately not loaded until its matching,
                # freshness and directionality rules have been implemented.
                "traffic_speed_kmh": None,
                "traffic_observed_at": None,
                "traffic_valid_until": None,
                "traffic_delay_seconds": 0.0,
            }
            graph.add_edge(
                from_id,
                to_id,
                key=str(row["id"]),
                **edge_attributes,
            )

        if graph.number_of_edges() == 0:
            raise ActiveGraphNotFound(
                "Lo snapshot attivo non contiene archi stradali utilizzabili."
            )

        return {
            "graph": graph,
            "snapshot_id": str(snapshot["id"]),
            "snapshot_version": str(snapshot["version"]),
            "area": str(snapshot["coverage_area"]),
            "model_version": str(snapshot["model_version"]),
            "built_at": snapshot["built_at"],
            "edge_count": len(rows),
        }

    def list_releases(self) -> list[dict[str, Any]]:
        import psycopg
        from psycopg.rows import dict_row

        query = """
        SELECT DISTINCT
            d.id::text AS id,
            d.source,
            d.version,
            d.source_url,
            d.attribution,
            d.license,
            d.acquired_at,
            d.data_valid_from,
            d.data_valid_to,
            d.checksum_sha256
        FROM public.dataset_release d
        JOIN public.road_edge e ON e.dataset_release_id = d.id
        JOIN public.graph_snapshot s ON s.id = e.snapshot_id
        WHERE s.status = 'active'
        ORDER BY d.source, d.version
        """
        with psycopg.connect(
            self.database_url,
            connect_timeout=8,
            row_factory=dict_row,
        ) as connection:
            return [dict(row) for row in connection.execute(query).fetchall()]
