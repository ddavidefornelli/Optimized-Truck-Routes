"""Validated API contracts. Unknown request fields are rejected deliberately."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Coordinate(StrictModel):
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-90, le=90)


class RoutingProfileName(StrEnum):
    SHORTEST = "shortest"
    BALANCED = "balanced"
    ROAD_COMFORT = "road_comfort"


class PreferenceMode(StrEnum):
    ALLOW = "allow"
    AVOID = "avoid"
    EXCLUDE = "exclude"


class UnknownRestrictionMode(StrEnum):
    WARN = "warn"
    EXCLUDE = "exclude"


class RoutePreferences(StrictModel):
    unpaved: PreferenceMode = PreferenceMode.AVOID
    narrow_roads: PreferenceMode = PreferenceMode.AVOID
    urban_areas: PreferenceMode = PreferenceMode.AVOID
    tight_curves: PreferenceMode = PreferenceMode.AVOID
    unlit_at_night: PreferenceMode = PreferenceMode.AVOID
    unknown_critical_restrictions: UnknownRestrictionMode = UnknownRestrictionMode.WARN


class RouteRequest(StrictModel):
    origin: Coordinate
    destination: Coordinate
    profiles: list[RoutingProfileName] = Field(
        default_factory=lambda: [
            RoutingProfileName.SHORTEST,
            RoutingProfileName.BALANCED,
            RoutingProfileName.ROAD_COMFORT,
        ],
        min_length=1,
        max_length=3,
    )
    preferences: RoutePreferences = Field(default_factory=RoutePreferences)
    departure_at: datetime | None = None

    @field_validator("departure_at")
    @classmethod
    def departure_must_be_timezone_aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("departure_at deve includere il fuso orario, ad esempio +03:00 o Z")
        return value

    @model_validator(mode="after")
    def profiles_must_be_unique(self) -> "RouteRequest":
        if len(set(self.profiles)) != len(self.profiles):
            raise ValueError("profiles non può contenere duplicati")
        return self


class VehicleProfileResponse(StrictModel):
    id: str
    version: str
    height_m: float | None
    width_m: float | None
    length_m: float | None
    gross_weight_kg: float | None
    axle_loads_kg: dict[str, float] | None
    validated: bool
    notes: str


class SnapPoint(StrictModel):
    requested: Coordinate
    snapped: Coordinate
    distance_m: float
    node_id: str


class RouteMetrics(StrictModel):
    unpaved_m: float
    narrow_m: float
    urban_proxy_m: float
    unlit_m: float
    unknown_surface_m: float
    unknown_width_m: float
    unknown_lighting_m: float
    unknown_urban_m: float
    unknown_curve_m: float
    documented_hazard_m: float
    road_attribute_coverage_pct: float


class CostContribution(StrictModel):
    time_seconds: float
    distance_equivalent_seconds: float
    surface_penalty_seconds: float
    width_penalty_seconds: float
    urban_penalty_seconds: float
    curve_penalty_seconds: float
    darkness_penalty_seconds: float
    unknown_data_penalty_seconds: float
    documented_hazard_penalty_seconds: float
    total_cost: float


class RouteAlternative(StrictModel):
    route_id: str
    profiles: list[RoutingProfileName]
    distance_m: float
    estimated_seconds: float
    cost_by_profile: dict[str, float]
    cost_breakdown_by_profile: dict[str, CostContribution]
    edge_ids: list[str]
    geometry: dict[str, Any]
    metrics: RouteMetrics
    compatibility_status: Literal["not_verified", "partially_verified", "verified"]
    warnings: list[str]
    explanations: list[str]


class GraphSnapshotInfo(StrictModel):
    id: str
    version: str
    area: str
    mode: Literal["demo", "supabase"]
    built_at: datetime | None = None
    model_version: str


class RouteComparisonResponse(StrictModel):
    request_id: str
    status: Literal["ok", "no_route"]
    mode: Literal["demo", "supabase"]
    vehicle_profile: VehicleProfileResponse
    snapshot: GraphSnapshotInfo
    recommended_route_id: str | None
    recommended_profile: RoutingProfileName | None
    origin_snap: SnapPoint
    destination_snap: SnapPoint
    routes: list[RouteAlternative]
    warnings: list[str]


class ReadyResponse(StrictModel):
    status: Literal["ready", "not_ready"]
    mode: Literal["demo", "supabase"]
    graph_nodes: int
    graph_edges: int
    snapshot_version: str | None = None
    detail: str | None = None


class DatasetReleaseInfo(StrictModel):
    id: str
    source: str
    version: str
    source_url: str | None = None
    attribution: str | None = None
    license: str | None = None
    acquired_at: datetime | None = None
    data_valid_from: datetime | None = None
    data_valid_to: datetime | None = None
    checksum_sha256: str | None = None
    is_synthetic: bool = False
    notes: str | None = None


class RoutingProfileInfo(StrictModel):
    name: RoutingProfileName
    label: str
    description: str
    w_time: float
    w_distance: float
    penalty_multiplier: float


class RoutingProfilesResponse(StrictModel):
    model_version: str
    vehicle_profile: VehicleProfileResponse
    route_profiles: list[RoutingProfileInfo]
    capabilities: dict[str, Any]
