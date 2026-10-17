"""A tiny, deterministic synthetic road network used only for development and tests."""

from __future__ import annotations

import networkx as nx


def build_demo_graph() -> nx.MultiDiGraph:
    """Create two alternatives between two Helsinki-area demo points.

    The data are fictional and intentionally labelled synthetic. They are not
    representations of actual streets and must never be used for navigation.
    """

    graph = nx.MultiDiGraph()
    nodes = {
        "HELSINKI_START": (24.9384, 60.1699),
        "INNER_A": (24.9460, 60.1735),
        "INNER_B": (24.9550, 60.1810),
        "ARTERIAL_A": (24.9450, 60.1660),
        "ARTERIAL_B": (24.9590, 60.1780),
        "HELSINKI_DEST": (24.9680, 60.1900),
    }
    for node_id, (longitude, latitude) in nodes.items():
        graph.add_node(node_id, longitude=longitude, latitude=latitude, level=0)

    # Each edge represents one directed road segment. Distances and attributes
    # are illustrative rather than surveyed measurements.
    edge_data = [
        (
            "HELSINKI_START", "INNER_A", "demo-inner-01",
            dict(length_m=700, speed_limit_kmh=30, surface="asphalt", surface_status="known",
                 width_m=4.0, width_status="known", illuminated=True, lighting_status="known",
                 urban_severity=0.85, curve_severity=0.25, hazard_severity=0.0, hazard_status="known",
                 restriction_status="unknown", closure_status="known", truck_access="unknown"),
        ),
        (
            "INNER_A", "INNER_B", "demo-inner-02",
            dict(length_m=750, speed_limit_kmh=25, surface="unpaved", surface_status="known",
                 width_m=3.2, width_status="known", illuminated=False, lighting_status="known",
                 urban_severity=0.55, curve_severity=0.82, hazard_severity=0.25, hazard_status="known",
                 restriction_status="unknown", closure_status="known", truck_access="unknown"),
        ),
        (
            "INNER_B", "HELSINKI_DEST", "demo-inner-03",
            dict(length_m=850, speed_limit_kmh=30, surface="asphalt", surface_status="known",
                 width_m=4.2, width_status="known", illuminated=False, lighting_status="known",
                 urban_severity=0.45, curve_severity=0.65, hazard_severity=0.0, hazard_status="known",
                 restriction_status="unknown", closure_status="known", truck_access="unknown"),
        ),
        (
            "HELSINKI_START", "ARTERIAL_A", "demo-arterial-01",
            dict(length_m=1200, speed_limit_kmh=50, surface="asphalt", surface_status="known",
                 width_m=7.0, width_status="known", illuminated=True, lighting_status="known",
                 urban_severity=0.20, curve_severity=0.10, hazard_severity=0.0, hazard_status="known",
                 restriction_status="known", closure_status="known", truck_access="allowed"),
        ),
        (
            "ARTERIAL_A", "ARTERIAL_B", "demo-arterial-02",
            dict(length_m=1500, speed_limit_kmh=70, surface="asphalt", surface_status="known",
                 width_m=8.0, width_status="known", illuminated=True, lighting_status="known",
                 urban_severity=0.05, curve_severity=0.08, hazard_severity=0.0, hazard_status="known",
                 restriction_status="known", closure_status="known", truck_access="allowed"),
        ),
        (
            "ARTERIAL_B", "HELSINKI_DEST", "demo-arterial-03",
            dict(length_m=1000, speed_limit_kmh=60, surface="asphalt", surface_status="known",
                 width_m=6.5, width_status="known", illuminated=True, lighting_status="known",
                 urban_severity=0.10, curve_severity=0.15, hazard_severity=0.0, hazard_status="known",
                 restriction_status="known", closure_status="known", truck_access="allowed"),
        ),
        # A longer parallel edge illustrates why a MultiDiGraph is useful.
        (
            "HELSINKI_START", "ARTERIAL_A", "demo-arterial-slower-parallel",
            dict(length_m=1450, speed_limit_kmh=40, surface="asphalt", surface_status="known",
                 width_m=6.0, width_status="known", illuminated=True, lighting_status="known",
                 urban_severity=0.15, curve_severity=0.20, hazard_severity=0.0, hazard_status="known",
                 restriction_status="known", closure_status="known", truck_access="allowed"),
        ),
    ]

    for source, target, edge_id, attributes in edge_data:
        source_data = graph.nodes[source]
        target_data = graph.nodes[target]
        graph.add_edge(
            source,
            target,
            key=edge_id,
            id=edge_id,
            geometry=[
                [source_data["longitude"], source_data["latitude"]],
                [target_data["longitude"], target_data["latitude"]],
            ],
            traffic_speed_kmh=None,
            traffic_observed_at=None,
            traffic_valid_until=None,
            **attributes,
        )

    return graph
