from __future__ import annotations

from fastapi.testclient import TestClient

from truck_routes.config import Settings, get_routing_weights, get_vehicle_profile
from truck_routes.demo import build_demo_graph
from truck_routes.main import app, create_app
from truck_routes.routing.engine import RoutingEngine

client = TestClient(app)


def test_health_is_independent_from_datasets():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_discloses_demo_mode():
    response = client.get("/ready")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["mode"] == "demo"
    assert payload["graph_edges"] > 0


def test_dataset_is_explicitly_synthetic():
    response = client.get("/api/v1/datasets")
    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["is_synthetic"] is True


def test_routing_profiles_expose_unvalidated_demo_vehicle():
    response = client.get("/api/v1/routing-profiles")
    assert response.status_code == 200
    payload = response.json()
    assert payload["vehicle_profile"]["validated"] is False
    assert {p["name"] for p in payload["route_profiles"]} == {"shortest", "balanced", "road_comfort"}


def test_route_endpoint_returns_two_distinct_tradeoffs():
    response = client.post(
        "/api/v1/routes",
        json={
            "origin": {"longitude": 24.9384, "latitude": 60.1699},
            "destination": {"longitude": 24.9680, "latitude": 60.1900},
            "profiles": ["shortest", "balanced", "road_comfort"],
            "departure_at": "2026-06-15T12:00:00+03:00",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["mode"] == "demo"
    assert len(payload["routes"]) >= 2
    assert payload["snapshot"]["area"] == "Helsinki synthetic demo"
    assert payload["recommended_profile"] == "balanced"
    recommended = next(route for route in payload["routes"] if route["route_id"] == payload["recommended_route_id"])
    assert "balanced" in recommended["profiles"]
    assert all(route["compatibility_status"] == "not_verified" for route in payload["routes"])


def test_vehicle_override_is_rejected_with_422():
    response = client.post(
        "/api/v1/routes",
        json={
            "origin": {"longitude": 24.9384, "latitude": 60.1699},
            "destination": {"longitude": 24.9680, "latitude": 60.1900},
            "vehicle": {"height_m": 3.0},
        },
    )
    assert response.status_code == 422


def test_invalid_profile_is_rejected():
    response = client.post(
        "/api/v1/routes",
        json={
            "origin": {"longitude": 24.9384, "latitude": 60.1699},
            "destination": {"longitude": 24.9680, "latitude": 60.1900},
            "profiles": ["safest"],
        },
    )
    assert response.status_code == 422


def test_coordinate_outside_coverage_is_422():
    response = client.post(
        "/api/v1/routes",
        json={
            "origin": {"longitude": 25.5, "latitude": 60.5},
            "destination": {"longitude": 24.9680, "latitude": 60.1900},
            "profiles": ["shortest"],
        },
    )
    assert response.status_code == 422


def test_supabase_mode_blocks_route_until_vehicle_profile_is_validated():
    engine = RoutingEngine(
        graph=build_demo_graph(),
        vehicle=get_vehicle_profile(),
        weights_config=get_routing_weights(),
        mode="supabase",
        snapshot_id="fixture-snapshot",
        snapshot_version="fixture-1",
        area="test area",
    )
    real_mode_app = create_app(
        settings=Settings(road_data_mode="supabase"),
        engine=engine,
    )
    real_client = TestClient(real_mode_app)
    ready_response = real_client.get("/ready")
    assert ready_response.status_code == 503
    assert ready_response.json()["status"] == "not_ready"

    route_response = real_client.post(
        "/api/v1/routes",
        json={
            "origin": {"longitude": 24.9384, "latitude": 60.1699},
            "destination": {"longitude": 24.9680, "latitude": 60.1900},
            "profiles": ["shortest"],
        },
    )
    assert route_response.status_code == 503
    assert "validare il profilo camion" in route_response.json()["detail"]
