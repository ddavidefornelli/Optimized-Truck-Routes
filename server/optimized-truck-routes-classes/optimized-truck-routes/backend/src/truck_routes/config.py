"""Application configuration and versioned prototype profiles."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ASSETS_DIR = Path(__file__).resolve().parent / "assets"


class Settings(BaseSettings):
    """Settings read from environment variables or a local .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Optimized Truck Routes API"
    app_env: Literal["development", "test", "production"] = "development"
    road_data_mode: Literal["demo", "supabase"] = "demo"
    supabase_db_url: str | None = Field(default=None, repr=False)
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


class VehicleProfile(BaseModel):
    """Vehicle dimensions used by the routing engine, separate from route preferences."""

    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    height_m: float | None = Field(default=None, gt=0)
    width_m: float | None = Field(default=None, gt=0)
    length_m: float | None = Field(default=None, gt=0)
    gross_weight_kg: float | None = Field(default=None, gt=0)
    axle_loads_kg: dict[str, float] | None = None
    validated: bool = False
    notes: str


def _load_json(filename: str) -> dict[str, Any]:
    with (ASSETS_DIR / filename).open(encoding="utf-8") as file:
        return json.load(file)


@lru_cache(maxsize=1)
def get_vehicle_profile() -> VehicleProfile:
    """Load a centrally configured profile; dimensions are not hardcoded in the algorithm."""

    return VehicleProfile.model_validate(_load_json("vehicle_profile.json"))


@lru_cache(maxsize=1)
def get_routing_weights() -> dict[str, Any]:
    """Return a stable copy of the versioned scoring configuration."""

    return _load_json("routing_weights.json")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
