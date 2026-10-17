"""Deterministic NetworkX routing and route comparison."""

from __future__ import annotations

from datetime import datetime
import hashlib
import math
from typing import Any
from zoneinfo import ZoneInfo

import networkx as nx

from truck_routes.config import VehicleProfile
from truck_routes.models import (
    Coordinate,
    CostContribution,
    RouteAlternative,
    RouteMetrics,
    RoutePreferences,
    RoutingProfileName,
    SnapPoint,
)
from truck_routes.routing.costs import (
    edge_exclusion_reason,
    effective_speed_kmh,
    is_dark_at,
    score_edge,
    width_severity,
)

HELSINKI_TZ = ZoneInfo("Europe/Helsinki")


class SnapError(ValueError):
    """Requested coordinate is too far from the loaded network."""


class NoRouteError(ValueError):
    """No path exists in the graph after applying known hard constraints."""


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    earth_radius_m = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return 2 * earth_radius_m * math.asin(math.sqrt(min(1.0, a)))


class RoutingEngine:
    def __init__(
        self,
        graph: nx.MultiDiGraph,
        vehicle: VehicleProfile,
        weights_config: dict[str, Any],
        mode: str = "demo",
        snapshot_id: str = "demo-synthetic-v1",
        snapshot_version: str = "demo-2026-10-11",
        area: str = "Helsinki synthetic demo",
        built_at: datetime | None = None,
    ) -> None:
        self.graph = graph
        self.vehicle = vehicle
        self.weights_config = weights_config
        self.mode = mode
        self.snapshot_id = snapshot_id
        self.snapshot_version = snapshot_version
        self.area = area
        self.built_at = built_at

    @property
    def node_count(self) -> int:
        return self.graph.number_of_nodes()

    @property
    def edge_count(self) -> int:
        return self.graph.number_of_edges()

    def _nearest_node(self, requested: Coordinate) -> tuple[str, float]:
        best_node: str | None = None
        best_distance = float("inf")
        for node_id, data in self.graph.nodes(data=True):
            distance = haversine_m(
                requested.longitude,
                requested.latitude,
                float(data["longitude"]),
                float(data["latitude"]),
            )
            if (distance, str(node_id)) < (best_distance, str(best_node)):
                best_node, best_distance = str(node_id), distance
        max_snap = float(self.weights_config.get("snap_max_distance_m", 2500))
        if best_node is None or best_distance > max_snap:
            raise SnapError(
                f"Coordinate fuori dalla copertura caricata o troppo lontana dalla rete "
                f"(limite di aggancio configurato: {max_snap:.0f} m)."
            )
        return best_node, best_distance

    def snap(self, requested: Coordinate) -> SnapPoint:
        node_id, distance = self._nearest_node(requested)
        node = self.graph.nodes[node_id]
        return SnapPoint(
            requested=requested,
            snapped=Coordinate(longitude=float(node["longitude"]), latitude=float(node["latitude"])),
            distance_m=round(distance, 1),
            node_id=node_id,
        )

    def _edge_is_dark(self, edge: dict[str, Any], departure_at: datetime) -> bool:
        coords = edge.get("geometry") or []
        if coords:
            if len(coords) >= 2:
                # Coarse midpoint from endpoints; imported geometry may contain
                # more vertices, but this avoids incorrectly using the endpoint
                # for a two-coordinate demo segment.
                longitude = (float(coords[0][0]) + float(coords[-1][0])) / 2
                latitude = (float(coords[0][1]) + float(coords[-1][1])) / 2
            else:
                longitude, latitude = float(coords[0][0]), float(coords[0][1])
        else:
            # Database loader should always provide line geometry; this fallback
            # keeps isolated unit fixtures usable.
            longitude, latitude = 24.9384, 60.1699
        return is_dark_at(longitude, latitude, departure_at)

    def _active_graph(
        self,
        profile: RoutingProfileName,
        preferences: RoutePreferences,
        departure_at: datetime,
    ) -> nx.MultiDiGraph:
        graph = nx.MultiDiGraph()
        graph.add_nodes_from((node, dict(attrs)) for node, attrs in self.graph.nodes(data=True))
        for source, target, key, edge in self.graph.edges(keys=True, data=True):
            dark = self._edge_is_dark(edge, departure_at)
            if edge_exclusion_reason(edge, self.vehicle, preferences, dark, self.weights_config):
                continue
            scored = score_edge(edge, profile, preferences, self.vehicle, self.weights_config, dark)
            graph.add_edge(source, target, key=key, **dict(edge), _cost=scored.total_cost, _dark=dark)
        return graph

    @staticmethod
    def _multigraph_weight(source: str, target: str, keyed_edges: dict[str, dict[str, Any]]) -> float:
        # NetworkX passes a mapping of edge-key -> attributes to callable weights
        # for MultiDiGraph; keep the selection deterministic on equal weights.
        return min((float(attrs["_cost"]) for attrs in keyed_edges.values()), default=float("inf"))

    def _choose_edges(self, graph: nx.MultiDiGraph, node_path: list[str]) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        for source, target in zip(node_path, node_path[1:]):
            options = graph.get_edge_data(source, target) or {}
            if not options:
                raise NoRouteError("Il grafo del percorso è cambiato durante il calcolo.")
            edge_key, edge = min(
                options.items(),
                key=lambda item: (float(item[1]["_cost"]), str(item[1].get("id", item[0]))),
            )
            selected.append({**edge, "id": str(edge.get("id", edge_key))})
        return selected

    def _find_path(
        self,
        origin_node: str,
        destination_node: str,
        profile: RoutingProfileName,
        preferences: RoutePreferences,
        departure_at: datetime,
    ) -> tuple[list[str], list[dict[str, Any]]]:
        graph = self._active_graph(profile, preferences, departure_at)
        if origin_node not in graph or destination_node not in graph:
            raise NoRouteError("Uno dei nodi agganciati non è accessibile con i vincoli selezionati.")
        try:
            nodes = nx.dijkstra_path(
                graph,
                origin_node,
                destination_node,
                weight=self._multigraph_weight,
            )
        except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
            raise NoRouteError("Nessun percorso nel grafo disponibile dopo i vincoli applicati.") from exc
        return nodes, self._choose_edges(graph, nodes)

    def _costs_for_path(
        self,
        edges: list[dict[str, Any]],
        profile: RoutingProfileName,
        preferences: RoutePreferences,
        departure_at: datetime,
    ) -> list[Any]:
        result = []
        for edge in edges:
            dark = self._edge_is_dark(edge, departure_at)
            result.append(score_edge(edge, profile, preferences, self.vehicle, self.weights_config, dark))
        return result

    def _metrics(self, edges: list[dict[str, Any]]) -> RouteMetrics:
        total_length = sum(max(0.0, float(edge.get("length_m", 0.0))) for edge in edges)
        unpaved = narrow = urban = unlit = 0.0
        unknown_surface = unknown_width = unknown_lighting = unknown_urban = unknown_curve = hazard = 0.0
        known_primary_attribute_length = 0.0
        for edge in edges:
            length = max(0.0, float(edge.get("length_m", 0.0)))
            if edge.get("surface_status") == "known":
                if edge.get("surface") == "unpaved":
                    unpaved += length
                known_primary_attribute_length += length
            else:
                unknown_surface += length
            if edge.get("width_status") == "known":
                if width_severity(edge, self.vehicle, self.weights_config) >= 0.5:
                    narrow += length
                known_primary_attribute_length += length
            else:
                unknown_width += length
            if edge.get("urban_severity") is not None:
                if float(edge.get("urban_severity") or 0) >= 0.7:
                    urban += length
            else:
                unknown_urban += length
            if edge.get("curve_severity") is None:
                unknown_curve += length
            if edge.get("lighting_status") == "known":
                if edge.get("illuminated") is False:
                    unlit += length
                known_primary_attribute_length += length
            else:
                unknown_lighting += length
            if edge.get("hazard_status") == "known" and float(edge.get("hazard_severity") or 0.0) > 0:
                hazard += length

        coverage = 100.0 if total_length <= 0 else 100.0 * known_primary_attribute_length / (total_length * 3)
        return RouteMetrics(
            unpaved_m=round(unpaved, 1),
            narrow_m=round(narrow, 1),
            urban_proxy_m=round(urban, 1),
            unlit_m=round(unlit, 1),
            unknown_surface_m=round(unknown_surface, 1),
            unknown_width_m=round(unknown_width, 1),
            unknown_lighting_m=round(unknown_lighting, 1),
            unknown_urban_m=round(unknown_urban, 1),
            unknown_curve_m=round(unknown_curve, 1),
            documented_hazard_m=round(hazard, 1),
            road_attribute_coverage_pct=round(min(100.0, coverage), 1),
        )

    @staticmethod
    def _geometry(edges: list[dict[str, Any]], origin_node: dict[str, Any]) -> dict[str, Any]:
        coordinates: list[list[float]] = []
        for edge in edges:
            edge_coords = edge.get("geometry") or []
            for coordinate in edge_coords:
                point = [float(coordinate[0]), float(coordinate[1])]
                if not coordinates or point != coordinates[-1]:
                    coordinates.append(point)
        if not coordinates:
            coordinates = [[float(origin_node["longitude"]), float(origin_node["latitude"])]]
        return {"type": "LineString", "coordinates": coordinates}

    def compute(
        self,
        origin: Coordinate,
        destination: Coordinate,
        profiles: list[RoutingProfileName],
        preferences: RoutePreferences,
        departure_at: datetime | None = None,
    ) -> dict[str, Any]:
        if departure_at is None:
            departure_at = datetime.now(HELSINKI_TZ)
        elif departure_at.tzinfo is None:
            raise ValueError("departure_at deve includere il fuso orario")

        origin_snap = self.snap(origin)
        destination_snap = self.snap(destination)
        raw_routes: dict[tuple[str, ...], dict[str, Any]] = {}
        failures: list[str] = []

        for profile in profiles:
            try:
                node_path, edges = self._find_path(
                    origin_snap.node_id,
                    destination_snap.node_id,
                    profile,
                    preferences,
                    departure_at,
                )
            except NoRouteError as exc:
                failures.append(f"{profile.value}: {exc}")
                continue

            edge_ids = tuple(str(edge["id"]) for edge in edges)
            costs = self._costs_for_path(edges, profile, preferences, departure_at)
            route = raw_routes.setdefault(
                edge_ids,
                {
                    "edge_ids": list(edge_ids),
                    "edges": edges,
                    "node_path": node_path,
                    "profiles": [],
                    "cost_by_profile": {},
                    "cost_breakdown_by_profile": {},
                },
            )
            route["profiles"].append(profile)
            route["cost_by_profile"][profile.value] = round(sum(item.total_cost for item in costs), 3)
            route["cost_breakdown_by_profile"][profile.value] = CostContribution.model_validate(
                {
                    key: round(sum(getattr(item, key) for item in costs), 3)
                    for key in CostContribution.model_fields
                }
            )

        if not raw_routes:
            return {
                "status": "no_route",
                "origin_snap": origin_snap,
                "destination_snap": destination_snap,
                "routes": [],
                "warnings": [
                    "Nessun percorso trovato nel grafo caricato. Questo non dimostra che non esista un percorso nella rete stradale reale.",
                    *failures,
                ],
            }

        # Explain alternatives relative to the shortest profile, if that profile
        # was requested and produced a route; otherwise use the shortest route
        # among the requested results only as a comparison baseline.
        shortest_key: tuple[str, ...] | None = None
        for key, route in raw_routes.items():
            if RoutingProfileName.SHORTEST in route["profiles"]:
                shortest_key = key
                break
        if shortest_key is None:
            shortest_key = min(
                raw_routes,
                key=lambda key: sum(float(e.get("length_m", 0)) for e in raw_routes[key]["edges"]),
            )

        baseline = raw_routes[shortest_key]
        baseline_distance = sum(float(edge.get("length_m", 0)) for edge in baseline["edges"])
        baseline_time = sum(self._estimated_seconds(edge) for edge in baseline["edges"])
        alternatives: list[RouteAlternative] = []
        for edge_ids, route in raw_routes.items():
            edges = route["edges"]
            distance = sum(float(edge.get("length_m", 0)) for edge in edges)
            estimated_seconds = sum(self._estimated_seconds(edge) for edge in edges)
            warnings = self._route_warnings(edges)
            if not self.vehicle.validated:
                warnings.append("Profilo camion dimostrativo non validato: compatibilità non certificata.")
            if any(edge.get("traffic_speed_kmh") is None for edge in edges):
                warnings.append("Traffico reale non disponibile per tutti i segmenti; durata basata su velocità statiche.")
            if self.mode == "demo":
                warnings.append("Rete sintetica dimostrativa: geometrie e attributi non rappresentano strade reali.")

            delta_distance = distance - baseline_distance
            delta_time = estimated_seconds - baseline_time
            if edge_ids == shortest_key:
                explanation = "Percorso di riferimento più breve fra quelli calcolati con i dati caricati."
            else:
                length_phrase = (
                    f"{abs(delta_distance):.0f} m più lungo"
                    if delta_distance >= 0
                    else f"{abs(delta_distance):.0f} m più corto"
                )
                time_phrase = (
                    f"{abs(delta_time) / 60:.1f} min in più"
                    if delta_time >= 0
                    else f"{abs(delta_time) / 60:.1f} min in meno"
                )
                other_unpaved = sum(float(e.get("length_m", 0)) for e in baseline["edges"] if e.get("surface") == "unpaved")
                this_unpaved = sum(float(e.get("length_m", 0)) for e in edges if e.get("surface") == "unpaved")
                explanation = (
                    f"Rispetto al percorso di riferimento: {length_phrase}, {time_phrase}; "
                    f"{max(0.0, other_unpaved - this_unpaved):.0f} m in meno di sterrato noto."
                )
            geometry = self._geometry(edges, self.graph.nodes[route["node_path"][0]])
            signature = hashlib.sha1("|".join(edge_ids).encode("utf-8")).hexdigest()[:10]
            alternatives.append(
                RouteAlternative(
                    route_id=f"route-{signature}",
                    profiles=route["profiles"],
                    distance_m=round(distance, 1),
                    estimated_seconds=round(estimated_seconds, 1),
                    cost_by_profile=route["cost_by_profile"],
                    cost_breakdown_by_profile=route["cost_breakdown_by_profile"],
                    edge_ids=list(edge_ids),
                    geometry=geometry,
                    metrics=self._metrics(edges),
                    compatibility_status="not_verified",
                    warnings=sorted(set(warnings)),
                    explanations=[explanation],
                )
            )

        alternatives.sort(key=lambda route: (route.distance_m, route.route_id))
        response_warnings = [
            "I risultati minimizzano il costo del modello: non sono una certificazione del percorso più sicuro o legalmente transitabile.",
            "Le svolte vietate non sono ancora modellate come transizioni fra archi; il prototipo usa un grafo diretto con sensi per segmento.",
        ]
        if self.mode == "supabase":
            response_warnings.append(
                "Il feed di traffico e restrizioni temporanee non è ancora integrato; verificare le fonti ufficiali prima di qualsiasi uso reale."
            )
        if failures:
            response_warnings.extend(failures)
        return {
            "status": "ok",
            "origin_snap": origin_snap,
            "destination_snap": destination_snap,
            "routes": alternatives,
            "warnings": response_warnings,
        }

    @staticmethod
    def _estimated_seconds(edge: dict[str, Any]) -> float:
        speed = effective_speed_kmh(edge)
        return max(0.0, float(edge.get("length_m", 0))) / (speed / 3.6) + max(
            0.0, float(edge.get("traffic_delay_seconds") or 0)
        )

    @staticmethod
    def _route_warnings(edges: list[dict[str, Any]]) -> list[str]:
        warnings: list[str] = []
        if any(edge.get("surface_status") != "known" for edge in edges):
            warnings.append("Il fondo stradale è sconosciuto su uno o più tratti.")
        if any(edge.get("width_status") != "known" for edge in edges):
            warnings.append("La larghezza rilevata è sconosciuta su uno o più tratti.")
        if any(edge.get("lighting_status") != "known" for edge in edges):
            warnings.append("La copertura del dato sull'illuminazione è incompleta.")
        if any(edge.get("restriction_status") != "known" for edge in edges):
            warnings.append("Compatibilità con alcune restrizioni critiche non verificabile.")
        if any(edge.get("truck_access") == "unknown" for edge in edges):
            warnings.append("L'accesso ai camion non è documentato su uno o più tratti.")
        if any(edge.get("urban_severity") is None for edge in edges):
            warnings.append("La proxy dell'area urbana è sconosciuta su uno o più tratti.")
        if any(edge.get("curve_severity") is None for edge in edges):
            warnings.append("L'indicatore geometrico delle curve è sconosciuto su uno o più tratti.")
        if any(edge.get("hazard_status") != "known" for edge in edges):
            warnings.append("La copertura degli eventi/condizioni critiche documentati è sconosciuta su uno o più tratti.")
        elif any(float(edge.get("hazard_severity") or 0) > 0 for edge in edges):
            warnings.append("Sono presenti condizioni/eventi documentati modellati nel dataset; verificarli sulla fonte.")
        if any(edge.get("closure_status") != "known" for edge in edges):
            warnings.append("Lo stato delle chiusure temporanee non è verificato su uno o più tratti.")
        return warnings
