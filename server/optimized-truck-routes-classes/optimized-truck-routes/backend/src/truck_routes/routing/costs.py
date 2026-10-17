"""Non-negative, explainable edge costs and truck access checks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
from typing import Any

from truck_routes.config import VehicleProfile
from truck_routes.models import RoutePreferences, RoutingProfileName


@dataclass(frozen=True)
class CostBreakdown:
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

    def as_dict(self) -> dict[str, float]:
        return {
            "time_seconds": round(self.time_seconds, 3),
            "distance_equivalent_seconds": round(self.distance_equivalent_seconds, 3),
            "surface_penalty_seconds": round(self.surface_penalty_seconds, 3),
            "width_penalty_seconds": round(self.width_penalty_seconds, 3),
            "urban_penalty_seconds": round(self.urban_penalty_seconds, 3),
            "curve_penalty_seconds": round(self.curve_penalty_seconds, 3),
            "darkness_penalty_seconds": round(self.darkness_penalty_seconds, 3),
            "unknown_data_penalty_seconds": round(self.unknown_data_penalty_seconds, 3),
            "documented_hazard_penalty_seconds": round(self.documented_hazard_penalty_seconds, 3),
            "total_cost": round(self.total_cost, 3),
        }


def clamp_severity(value: Any) -> float:
    """Normalize a known numeric severity to [0, 1]."""

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(numeric_value):
        return 0.0
    return max(0.0, min(1.0, numeric_value))


def width_severity(edge: dict[str, Any], vehicle: VehicleProfile, config: dict[str, Any]) -> float:
    """Approximate narrowness; roadway width is not a legal vehicle-width limit."""

    road_width = edge.get("width_m")
    if edge.get("width_status") != "known" or road_width is None or vehicle.width_m is None:
        return 0.0
    margin = float(config.get("narrow_width_margin_m", 1.2))
    reference = vehicle.width_m + margin
    if road_width >= reference + 1.5:
        return 0.0
    return clamp_severity((reference - float(road_width)) / 1.5)


def solar_elevation_degrees(longitude: float, latitude: float, when: datetime) -> float:
    """Approximate solar elevation from NOAA equations, including polar day/night.

    This is a coarse solar-position estimate for routing penalties, not a
    navigational astronomy library. It naturally handles polar day and night
    by evaluating solar elevation rather than assuming sunrise/sunset exist.
    """

    local = when
    if local.tzinfo is None:
        raise ValueError("when deve includere il fuso orario")
    utc_offset_hours = local.utcoffset().total_seconds() / 3600 if local.utcoffset() else 0.0
    fractional_hour = local.hour + local.minute / 60 + local.second / 3600
    day_number = local.timetuple().tm_yday
    gamma = 2 * math.pi / 365 * (day_number - 1 + (fractional_hour - 12) / 24)

    equation_of_time = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    declination = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )
    true_solar_minutes = fractional_hour * 60 + equation_of_time + 4 * longitude - 60 * utc_offset_hours
    hour_angle_degrees = (true_solar_minutes / 4) - 180
    hour_angle = math.radians(((hour_angle_degrees + 180) % 360) - 180)
    lat_rad = math.radians(latitude)
    cosine_zenith = (
        math.sin(lat_rad) * math.sin(declination)
        + math.cos(lat_rad) * math.cos(declination) * math.cos(hour_angle)
    )
    cosine_zenith = max(-1.0, min(1.0, cosine_zenith))
    return 90.0 - math.degrees(math.acos(cosine_zenith))


def is_dark_at(longitude: float, latitude: float, when: datetime) -> bool:
    """Treat solar elevation below the horizon as night, including polar night.

    This intentionally uses the horizon (0 degrees), rather than claiming to
    model street-level visibility or full astronomical darkness.
    """

    return solar_elevation_degrees(longitude, latitude, when) <= 0.0


def _preference_enabled(preference: str) -> bool:
    return preference != "allow"


def edge_exclusion_reason(
    edge: dict[str, Any],
    vehicle: VehicleProfile,
    preferences: RoutePreferences,
    dark: bool,
    config: dict[str, Any],
) -> str | None:
    """Return a reason when a known hard constraint makes an edge unusable."""

    if edge.get("closed") is True:
        return "chiusura attiva"
    if edge.get("truck_access") == "forbidden":
        return "accesso vietato ai camion"

    for vehicle_attr, edge_attr, label in (
        ("height_m", "max_vehicle_height_m", "altezza"),
        ("width_m", "max_vehicle_width_m", "larghezza legale"),
        ("length_m", "max_vehicle_length_m", "lunghezza"),
        ("gross_weight_kg", "max_vehicle_weight_kg", "massa"),
    ):
        vehicle_value = getattr(vehicle, vehicle_attr)
        legal_limit = edge.get(edge_attr)
        if vehicle_value is not None and legal_limit is not None and vehicle_value > legal_limit:
            return f"limite di {label} incompatibile con il profilo configurato"

    if preferences.unknown_critical_restrictions == "exclude" and (
        edge.get("restriction_status") != "known"
        or edge.get("closure_status") != "known"
        or edge.get("truck_access") == "unknown"
    ):
        return "restrizioni critiche o stato delle chiusure sconosciuti e policy prudente attiva"

    if preferences.unpaved == "exclude" and edge.get("surface_status") == "known" and edge.get("surface") == "unpaved":
        return "fondo sterrato escluso dalle preferenze"

    if preferences.narrow_roads == "exclude" and edge.get("width_status") == "known":
        if width_severity(edge, vehicle, config) >= 0.5:
            return "strada stretta esclusa dalle preferenze"

    if preferences.urban_areas == "exclude" and clamp_severity(edge.get("urban_severity")) >= 0.7:
        return "tratto urbano escluso dalle preferenze"

    if preferences.tight_curves == "exclude" and clamp_severity(edge.get("curve_severity")) >= 0.7:
        return "curva stretta esclusa dalle preferenze"

    if (
        dark
        and preferences.unlit_at_night == "exclude"
        and edge.get("lighting_status") == "known"
        and edge.get("illuminated") is False
    ):
        return "tratto non illuminato escluso durante il buio astronomico"

    return None


def effective_speed_kmh(edge: dict[str, Any]) -> float:
    """Use fresh observed speed if available; otherwise return the static fallback."""

    speed_kmh = edge.get("traffic_speed_kmh") if _traffic_is_fresh(edge) else None
    if speed_kmh is None or float(speed_kmh) <= 0:
        speed_kmh = edge.get("speed_limit_kmh")
    if speed_kmh is None or float(speed_kmh) <= 0:
        speed_kmh = 30.0  # explicit fallback; ETA remains non-certified
    return float(speed_kmh)


def score_edge(
    edge: dict[str, Any],
    profile: RoutingProfileName,
    preferences: RoutePreferences,
    vehicle: VehicleProfile,
    weights_config: dict[str, Any],
    dark: bool,
) -> CostBreakdown:
    """Score a road segment using versioned, non-negative cost components."""

    profile_config = weights_config["profiles"][profile.value]
    coefficients = weights_config["penalty_seconds_per_metre"]
    multiplier = float(profile_config["penalty_multiplier"])
    length_m = max(0.0, float(edge.get("length_m", 0.0)))

    speed_kmh = effective_speed_kmh(edge)
    time_seconds = length_m / (speed_kmh / 3.6) + max(0.0, float(edge.get("traffic_delay_seconds") or 0.0))
    ref_speed = float(weights_config["reference_speed_m_per_s"])
    distance_equivalent = length_m / ref_speed

    surface_status = edge.get("surface_status", "unknown")
    if surface_status == "known":
        surface_severity = 1.0 if edge.get("surface") == "unpaved" else 0.0
    else:
        surface_severity = 0.0

    severity_width = width_severity(edge, vehicle, weights_config)
    urban = clamp_severity(edge.get("urban_severity"))
    curve = clamp_severity(edge.get("curve_severity"))
    hazard = (
        clamp_severity(edge.get("hazard_severity"))
        if edge.get("hazard_status") == "known"
        else 0.0
    )
    dark_unlit = (
        1.0
        if dark and edge.get("lighting_status") == "known" and edge.get("illuminated") is False
        else 0.0
    )

    known_severities = {
        "surface": (surface_severity, surface_status == "known", preferences.unpaved),
        "width": (severity_width, edge.get("width_status") == "known", preferences.narrow_roads),
        "urban": (urban, edge.get("urban_severity") is not None, preferences.urban_areas),
        "curve": (curve, edge.get("curve_severity") is not None, preferences.tight_curves),
        "dark": (dark_unlit, edge.get("lighting_status") == "known", preferences.unlit_at_night),
    }

    # For the shortest profile, distance alone is the soft objective. Hard
    # constraints and explicit 'exclude' preferences are still applied.
    if profile == RoutingProfileName.SHORTEST:
        return CostBreakdown(
            time_seconds=0.0,
            distance_equivalent_seconds=distance_equivalent,
            surface_penalty_seconds=0.0,
            width_penalty_seconds=0.0,
            urban_penalty_seconds=0.0,
            curve_penalty_seconds=0.0,
            darkness_penalty_seconds=0.0,
            unknown_data_penalty_seconds=0.0,
            documented_hazard_penalty_seconds=0.0,
            total_cost=distance_equivalent,
        )

    penalties: dict[str, float] = {}
    for component, (severity, known, preference) in known_severities.items():
        penalties[component] = (
            length_m * float(coefficients[component]) * severity
            if known and _preference_enabled(preference)
            else 0.0
        )

    unknown_count = sum(
        [
            edge.get("surface_status", "unknown") != "known",
            edge.get("width_status", "unknown") != "known",
            edge.get("lighting_status", "unknown") != "known",
            edge.get("restriction_status", "unknown") != "known",
            edge.get("urban_severity") is None,
            edge.get("curve_severity") is None,
            edge.get("hazard_status", "unknown") != "known",
            edge.get("closure_status", "unknown") != "known",
            edge.get("truck_access", "unknown") == "unknown",
        ]
    )
    unknown_severity = unknown_count / 9.0
    unknown_penalty = length_m * float(coefficients["unknown"]) * unknown_severity
    hazard_penalty = length_m * float(coefficients["documented_hazard"]) * hazard
    time_component = float(profile_config["w_time"]) * time_seconds
    distance_component = float(profile_config["w_distance"]) * distance_equivalent
    total = (
        time_component
        + distance_component
        + multiplier
        * (
            sum(penalties.values())
            + unknown_penalty
            + hazard_penalty
        )
    )

    return CostBreakdown(
        time_seconds=time_component,
        distance_equivalent_seconds=distance_component,
        surface_penalty_seconds=multiplier * penalties["surface"],
        width_penalty_seconds=multiplier * penalties["width"],
        urban_penalty_seconds=multiplier * penalties["urban"],
        curve_penalty_seconds=multiplier * penalties["curve"],
        darkness_penalty_seconds=multiplier * penalties["dark"],
        unknown_data_penalty_seconds=multiplier * unknown_penalty,
        documented_hazard_penalty_seconds=multiplier * hazard_penalty,
        total_cost=total,
    )


def _traffic_is_fresh(edge: dict[str, Any]) -> bool:
    """Check timestamps before treating an observation as current traffic."""

    from datetime import timezone

    observed_at = edge.get("traffic_observed_at")
    valid_until = edge.get("traffic_valid_until")
    if observed_at is None or valid_until is None:
        return False
    now = datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    if valid_until.tzinfo is None:
        valid_until = valid_until.replace(tzinfo=timezone.utc)
    return observed_at <= now <= valid_until
