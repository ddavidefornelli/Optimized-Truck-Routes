"""FastAPI entry point."""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from truck_routes.config import Settings, VehicleProfile, get_routing_weights, get_settings, get_vehicle_profile
from truck_routes.demo import build_demo_graph
from truck_routes.models import (
    DatasetReleaseInfo,
    GraphSnapshotInfo,
    ReadyResponse,
    RouteRequest,
    RouteComparisonResponse,
    RoutingProfileInfo,
    RoutingProfileName,
    RoutingProfilesResponse,
    VehicleProfileResponse,
)
from truck_routes.routing.engine import RoutingEngine, SnapError
from truck_routes.storage.supabase import SupabaseGraphStore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("truck_routes")


def _profile_response(vehicle: VehicleProfile) -> VehicleProfileResponse:
    return VehicleProfileResponse.model_validate(vehicle.model_dump())


def _build_engine(settings: Settings) -> tuple[RoutingEngine | None, str | None]:
    vehicle = get_vehicle_profile()
    weights = get_routing_weights()
    if settings.road_data_mode == "demo":
        return (
            RoutingEngine(
                graph=build_demo_graph(),
                vehicle=vehicle,
                weights_config=weights,
                mode="demo",
                snapshot_id="demo-synthetic-v1",
                snapshot_version="demo-2026-10-11",
                area="Helsinki synthetic demo",
            ),
            None,
        )

    if not settings.supabase_db_url:
        return None, "SUPABASE_DB_URL non configurata."
    try:
        loaded = SupabaseGraphStore(settings.supabase_db_url).load_graph()
        return (
            RoutingEngine(
                graph=loaded["graph"],
                vehicle=vehicle,
                weights_config=weights,
                mode="supabase",
                snapshot_id=loaded["snapshot_id"],
                snapshot_version=loaded["snapshot_version"],
                area=loaded["area"],
                built_at=loaded["built_at"],
            ),
            None,
        )
    except Exception as exc:  # API stays up for health diagnostics; routing returns 503.
        logger.exception("Unable to load the active Supabase graph snapshot")
        return None, f"Impossibile caricare lo snapshot attivo: {type(exc).__name__}."


def create_app(
    settings: Settings | None = None,
    engine: RoutingEngine | None = None,
    engine_error: str | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if engine is None and engine_error is None:
        engine, engine_error = _build_engine(settings)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=(
            "API prototipo per confronto di percorsi per mezzi pesanti. "
            "La modalità demo usa esclusivamente una rete sintetica."
        ),
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.engine_error = engine_error
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        """Process liveness; it does not depend on external services."""

        return {"status": "ok"}

    @app.get("/ready", response_model=ReadyResponse, tags=["system"])
    def ready(response: Response) -> ReadyResponse:
        current_engine: RoutingEngine | None = app.state.engine
        if current_engine is None:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return ReadyResponse(
                status="not_ready",
                mode=settings.road_data_mode,
                graph_nodes=0,
                graph_edges=0,
                detail=app.state.engine_error or "Grafo non disponibile.",
            )
        if current_engine.mode == "supabase" and not current_engine.vehicle.validated:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return ReadyResponse(
                status="not_ready",
                mode="supabase",
                graph_nodes=current_engine.node_count,
                graph_edges=current_engine.edge_count,
                snapshot_version=current_engine.snapshot_version,
                detail="Profilo standard del camion non validato: routing reale disabilitato.",
            )
        return ReadyResponse(
            status="ready",
            mode=current_engine.mode,
            graph_nodes=current_engine.node_count,
            graph_edges=current_engine.edge_count,
            snapshot_version=current_engine.snapshot_version,
        )

    @app.get("/api/v1/datasets", response_model=list[DatasetReleaseInfo], tags=["datasets"])
    def datasets() -> list[DatasetReleaseInfo]:
        current_engine: RoutingEngine | None = app.state.engine
        if current_engine is None:
            raise HTTPException(status_code=503, detail="Il grafo non è pronto.")
        if current_engine.mode == "demo":
            return [
                DatasetReleaseInfo(
                    id="demo-synthetic-v1",
                    source="synthetic-demo",
                    version="1",
                    is_synthetic=True,
                    notes="Dati inventati per test. Non sono una mappa reale di Helsinki.",
                )
            ]
        try:
            releases = SupabaseGraphStore(settings.supabase_db_url or "").list_releases()
            return [DatasetReleaseInfo.model_validate(row) for row in releases]
        except Exception as exc:
            logger.exception("Unable to read active dataset release metadata")
            raise HTTPException(
                status_code=503,
                detail=f"Metadati dataset non disponibili ({type(exc).__name__}).",
            ) from exc

    @app.get(
        "/api/v1/routing-profiles",
        response_model=RoutingProfilesResponse,
        tags=["routing"],
    )
    def routing_profiles() -> RoutingProfilesResponse:
        vehicle = get_vehicle_profile()
        weights = get_routing_weights()
        descriptions = {
            "shortest": "Minimizza la distanza fra i percorsi ammissibili; le preferenze 'avoid' non alterano il costo morbido.",
            "balanced": "Combina durata stimata, distanza e penalità stradali configurate.",
            "road_comfort": "Dà maggiore peso alle penalità modellate per fondo, larghezza, urbanità e curve.",
        }
        profiles = [
            RoutingProfileInfo(
                name=name,
                label=values["label"],
                description=descriptions[name],
                w_time=values["w_time"],
                w_distance=values["w_distance"],
                penalty_multiplier=values["penalty_multiplier"],
            )
            for name, values in weights["profiles"].items()
        ]
        return RoutingProfilesResponse(
            model_version=weights["model_version"],
            vehicle_profile=_profile_response(vehicle),
            route_profiles=profiles,
            capabilities={
                "traffic_observations": False,
                "temporary_restrictions_feed": False,
                "turn_restrictions": False,
                "blind_curve_detection": False,
                "real_road_data_loaded": bool(app.state.engine and app.state.engine.mode == "supabase"),
            },
        )

    @app.post(
        "/api/v1/routes",
        response_model=RouteComparisonResponse,
        tags=["routing"],
    )
    def calculate_routes(route_request: RouteRequest) -> RouteComparisonResponse:
        current_engine: RoutingEngine | None = app.state.engine
        if current_engine is None:
            raise HTTPException(status_code=503, detail="Routing non pronto: il grafo reale non è disponibile.")
        if current_engine.mode == "supabase" and not current_engine.vehicle.validated:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Routing reale disabilitato: configurare e validare il profilo camion standard "
                    "prima di utilizzare dati stradali reali."
                ),
            )
        try:
            result: dict[str, Any] = current_engine.compute(
                origin=route_request.origin,
                destination=route_request.destination,
                profiles=route_request.profiles,
                preferences=route_request.preferences,
                departure_at=route_request.departure_at,
            )
        except SnapError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        # Prefer the balanced result as the default recommendation; when the
        # client asks for a subset, use its first requested profile.
        recommendation_profile = (
            RoutingProfileName.BALANCED
            if RoutingProfileName.BALANCED in route_request.profiles
            else route_request.profiles[0]
        )
        recommended_route = next(
            (route for route in result["routes"] if recommendation_profile in route.profiles),
            None,
        )
        response = RouteComparisonResponse(
            request_id=str(uuid4()),
            status=result["status"],
            mode=current_engine.mode,
            vehicle_profile=_profile_response(current_engine.vehicle),
            snapshot=GraphSnapshotInfo(
                id=current_engine.snapshot_id,
                version=current_engine.snapshot_version,
                area=current_engine.area,
                mode=current_engine.mode,
                built_at=current_engine.built_at,
                model_version=get_routing_weights()["model_version"],
            ),
            recommended_route_id=recommended_route.route_id if recommended_route else None,
            recommended_profile=recommendation_profile if recommended_route else None,
            origin_snap=result["origin_snap"],
            destination_snap=result["destination_snap"],
            routes=result["routes"],
            warnings=result["warnings"],
        )
        # Only operational metadata is logged. Coordinates are intentionally omitted.
        logger.info(
            "route_calculation_complete request_id=%s mode=%s status=%s alternatives=%d",
            response.request_id,
            response.mode,
            response.status,
            len(response.routes),
        )
        return response

    return app


app = create_app()
