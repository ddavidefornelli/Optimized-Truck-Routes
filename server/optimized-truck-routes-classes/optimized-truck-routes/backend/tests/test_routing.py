from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from truck_routes.config import get_routing_weights, get_vehicle_profile
from truck_routes.demo import build_demo_graph
from truck_routes.models import Coordinate, RoutePreferences, RoutingProfileName
from truck_routes.routing.costs import effective_speed_kmh, is_dark_at, solar_elevation_degrees
from truck_routes.routing.engine import RoutingEngine, SnapError


@pytest.fixture()
def engine() -> RoutingEngine:
    return RoutingEngine(
        graph=build_demo_graph(),
        vehicle=get_vehicle_profile(),
        weights_config=get_routing_weights(),
    )


def coords():
    return (
        Coordinate(longitude=24.9384, latitude=60.1699),
        Coordinate(longitude=24.9680, latitude=60.1900),
    )


def summer_noon() -> datetime:
    return datetime(2026, 6, 15, 12, 0, tzinfo=ZoneInfo("Europe/Helsinki"))


def test_shortest_and_comfort_profiles_choose_different_routes(engine: RoutingEngine):
    origin, destination = coords()
    result = engine.compute(
        origin,
        destination,
        [RoutingProfileName.SHORTEST, RoutingProfileName.BALANCED, RoutingProfileName.ROAD_COMFORT],
        RoutePreferences(),
        summer_noon(),
    )

    assert result["status"] == "ok"
    assert len(result["routes"]) >= 2
    shortest = next(route for route in result["routes"] if "demo-inner-02" in route.edge_ids)
    comfort = next(route for route in result["routes"] if "demo-arterial-02" in route.edge_ids)
    assert shortest.distance_m < comfort.distance_m
    assert shortest.metrics.unpaved_m > 0
    assert comfort.metrics.unpaved_m == 0
    assert RoutingProfileName.SHORTEST in shortest.profiles
    assert RoutingProfileName.ROAD_COMFORT in comfort.profiles


def test_exclude_unpaved_never_uses_known_unpaved_edge(engine: RoutingEngine):
    origin, destination = coords()
    preferences = RoutePreferences(unpaved="exclude")
    result = engine.compute(
        origin,
        destination,
        [RoutingProfileName.SHORTEST],
        preferences,
        summer_noon(),
    )
    assert result["status"] == "ok"
    assert all("demo-inner-02" not in route.edge_ids for route in result["routes"])
    assert result["routes"][0].metrics.unpaved_m == 0


def test_known_incompatible_height_limit_is_a_hard_constraint(engine: RoutingEngine):
    for _, _, _, attributes in engine.graph.edges(keys=True, data=True):
        if str(attributes["id"]).startswith("demo-inner"):
            attributes["max_vehicle_height_m"] = 3.0
    origin, destination = coords()
    result = engine.compute(
        origin,
        destination,
        [RoutingProfileName.SHORTEST],
        RoutePreferences(),
        summer_noon(),
    )
    assert result["status"] == "ok"
    assert "demo-arterial-01" in result["routes"][0].edge_ids
    assert not any(edge_id.startswith("demo-inner") for edge_id in result["routes"][0].edge_ids)


def test_closed_edges_are_removed_from_graph(engine: RoutingEngine):
    for _, _, _, attributes in engine.graph.edges(keys=True, data=True):
        attributes["closed"] = True
    origin, destination = coords()
    result = engine.compute(
        origin,
        destination,
        [RoutingProfileName.SHORTEST],
        RoutePreferences(),
        summer_noon(),
    )
    assert result["status"] == "no_route"
    assert result["routes"] == []
    assert any("non dimostra" in warning for warning in result["warnings"])


def test_coordinates_outside_demo_coverage_are_rejected(engine: RoutingEngine):
    with pytest.raises(SnapError):
        engine.snap(Coordinate(longitude=25.5, latitude=60.5))


def test_unknown_restrictions_can_be_excluded_prudently(engine: RoutingEngine):
    origin, destination = coords()
    result = engine.compute(
        origin,
        destination,
        [RoutingProfileName.SHORTEST],
        RoutePreferences(unknown_critical_restrictions="exclude"),
        summer_noon(),
    )
    assert result["status"] == "ok"
    assert all(not any(edge_id.startswith("demo-inner") for edge_id in route.edge_ids) for route in result["routes"])


def test_parallel_edges_are_preserved():
    graph = build_demo_graph()
    parallels = graph.get_edge_data("HELSINKI_START", "ARTERIAL_A")
    assert parallels is not None and len(parallels) == 2


def test_solar_model_handles_polar_day_and_night():
    polar_day = datetime(2026, 6, 21, 12, 0, tzinfo=ZoneInfo("Europe/Helsinki"))
    polar_night = datetime(2026, 12, 21, 12, 0, tzinfo=ZoneInfo("Europe/Helsinki"))
    day_elevation = solar_elevation_degrees(25.0, 69.0, polar_day)
    night_elevation = solar_elevation_degrees(25.0, 69.0, polar_night)
    assert day_elevation > night_elevation
    assert is_dark_at(25.0, 69.0, polar_night)
    assert not is_dark_at(25.0, 69.0, polar_day)


def test_expired_traffic_observation_does_not_override_static_speed():
    from datetime import timedelta, timezone

    now = datetime.now(timezone.utc)
    edge = {
        "traffic_speed_kmh": 8.0,
        "traffic_observed_at": now - timedelta(hours=2),
        "traffic_valid_until": now - timedelta(hours=1),
        "speed_limit_kmh": 50.0,
    }
    assert effective_speed_kmh(edge) == 50.0


def test_fresh_traffic_observation_is_used():
    from datetime import timedelta, timezone

    now = datetime.now(timezone.utc)
    edge = {
        "traffic_speed_kmh": 22.0,
        "traffic_observed_at": now - timedelta(minutes=2),
        "traffic_valid_until": now + timedelta(minutes=5),
        "speed_limit_kmh": 50.0,
    }
    assert effective_speed_kmh(edge) == 22.0
