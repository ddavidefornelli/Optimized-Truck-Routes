-- Optimized Truck Routes: initial PostGIS schema.
-- Enable PostGIS in Supabase first if your project manages extensions centrally.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.dataset_release (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    version text NOT NULL,
    source_url text,
    checksum_sha256 text,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    data_valid_from timestamptz,
    data_valid_to timestamptz,
    license text,
    attribution text,
    qa_report jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, version, checksum_sha256),
    CHECK (data_valid_to IS NULL OR data_valid_from IS NULL OR data_valid_to >= data_valid_from)
);

CREATE TABLE IF NOT EXISTS public.graph_snapshot (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text NOT NULL,
    model_version text NOT NULL,
    coverage_area text NOT NULL,
    status text NOT NULL DEFAULT 'building'
        CHECK (status IN ('building', 'validated', 'active', 'retired', 'failed')),
    qa_report jsonb NOT NULL DEFAULT '{}'::jsonb,
    built_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one snapshot should be active at a time for this first single-area MVP.
CREATE UNIQUE INDEX IF NOT EXISTS graph_snapshot_one_active_idx
    ON public.graph_snapshot ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.road_node (
    id text PRIMARY KEY,
    source_node_id text,
    source_release_id uuid REFERENCES public.dataset_release(id),
    geom extensions.geometry(Point, 3067) NOT NULL,
    level integer NOT NULL DEFAULT 0,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS road_node_geom_gix ON public.road_node USING gist (geom);

CREATE TABLE IF NOT EXISTS public.road_edge (
    id text PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES public.graph_snapshot(id) ON DELETE CASCADE,
    dataset_release_id uuid REFERENCES public.dataset_release(id),
    source_edge_id text,
    from_node_id text NOT NULL REFERENCES public.road_node(id),
    to_node_id text NOT NULL REFERENCES public.road_node(id),
    geom extensions.geometry(LineString, 3067) NOT NULL,
    length_m double precision NOT NULL CHECK (length_m > 0),
    road_class text,
    speed_limit_kmh double precision CHECK (speed_limit_kmh IS NULL OR speed_limit_kmh > 0),

    -- Keep missingness independent from the value: 'unknown' is not 'no'.
    surface text CHECK (surface IS NULL OR surface IN ('asphalt', 'unpaved', 'other', 'unknown')),
    surface_status text NOT NULL DEFAULT 'unknown'
        CHECK (surface_status IN ('known', 'unknown', 'not_applicable')),
    width_m double precision CHECK (width_m IS NULL OR width_m > 0),
    width_status text NOT NULL DEFAULT 'unknown'
        CHECK (width_status IN ('known', 'unknown', 'not_applicable')),
    illuminated boolean,
    lighting_status text NOT NULL DEFAULT 'unknown'
        CHECK (lighting_status IN ('known', 'unknown', 'not_applicable')),
    urban_severity double precision CHECK (urban_severity IS NULL OR urban_severity BETWEEN 0 AND 1),
    curve_severity double precision CHECK (curve_severity IS NULL OR curve_severity BETWEEN 0 AND 1),
    hazard_severity double precision CHECK (hazard_severity IS NULL OR hazard_severity BETWEEN 0 AND 1),
    hazard_status text NOT NULL DEFAULT 'unknown'
        CHECK (hazard_status IN ('known', 'unknown', 'not_applicable')),

    -- Legal limits are distinct from measured roadway width/geometry.
    restriction_status text NOT NULL DEFAULT 'unknown'
        CHECK (restriction_status IN ('known', 'unknown', 'not_applicable')),
    closure_status text NOT NULL DEFAULT 'unknown'
        CHECK (closure_status IN ('known', 'unknown', 'not_applicable')),
    truck_access text NOT NULL DEFAULT 'unknown'
        CHECK (truck_access IN ('allowed', 'forbidden', 'unknown')),
    max_vehicle_height_m double precision CHECK (max_vehicle_height_m IS NULL OR max_vehicle_height_m > 0),
    max_vehicle_width_m double precision CHECK (max_vehicle_width_m IS NULL OR max_vehicle_width_m > 0),
    max_vehicle_length_m double precision CHECK (max_vehicle_length_m IS NULL OR max_vehicle_length_m > 0),
    max_vehicle_weight_kg double precision CHECK (max_vehicle_weight_kg IS NULL OR max_vehicle_weight_kg > 0),
    closed boolean NOT NULL DEFAULT false,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (hazard_status <> 'known' OR hazard_severity IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS road_edge_snapshot_idx ON public.road_edge (snapshot_id);
CREATE INDEX IF NOT EXISTS road_edge_from_node_idx ON public.road_edge (from_node_id);
CREATE INDEX IF NOT EXISTS road_edge_to_node_idx ON public.road_edge (to_node_id);
CREATE INDEX IF NOT EXISTS road_edge_geom_gix ON public.road_edge USING gist (geom);

CREATE TABLE IF NOT EXISTS public.road_restriction (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid NOT NULL REFERENCES public.graph_snapshot(id) ON DELETE CASCADE,
    road_edge_id text REFERENCES public.road_edge(id) ON DELETE CASCADE,
    from_edge_id text REFERENCES public.road_edge(id) ON DELETE CASCADE,
    to_edge_id text REFERENCES public.road_edge(id) ON DELETE CASCADE,
    restriction_type text NOT NULL,
    numeric_value double precision,
    value_unit text,
    applies_to jsonb NOT NULL DEFAULT '{}'::jsonb,
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    valid_from timestamptz,
    valid_until timestamptz,
    source_release_id uuid REFERENCES public.dataset_release(id),
    source_reference text,
    CHECK (
        (road_edge_id IS NOT NULL AND from_edge_id IS NULL AND to_edge_id IS NULL)
        OR (road_edge_id IS NULL AND from_edge_id IS NOT NULL AND to_edge_id IS NOT NULL)
    ),
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS road_restriction_validity_idx
    ON public.road_restriction (valid_from, valid_until);

CREATE TABLE IF NOT EXISTS public.turn_rule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid NOT NULL REFERENCES public.graph_snapshot(id) ON DELETE CASCADE,
    from_edge_id text NOT NULL REFERENCES public.road_edge(id) ON DELETE CASCADE,
    to_edge_id text NOT NULL REFERENCES public.road_edge(id) ON DELETE CASCADE,
    prohibited boolean NOT NULL DEFAULT false,
    penalty_seconds double precision NOT NULL DEFAULT 0 CHECK (penalty_seconds >= 0),
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    valid_from timestamptz,
    valid_until timestamptz,
    source_release_id uuid REFERENCES public.dataset_release(id),
    UNIQUE (snapshot_id, from_edge_id, to_edge_id, valid_from)
);

CREATE TABLE IF NOT EXISTS public.dynamic_observation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid NOT NULL REFERENCES public.graph_snapshot(id) ON DELETE CASCADE,
    road_edge_id text REFERENCES public.road_edge(id) ON DELETE CASCADE,
    observation_type text NOT NULL,
    value_numeric double precision,
    value_text text,
    observed_at timestamptz NOT NULL,
    valid_from timestamptz,
    valid_until timestamptz,
    match_confidence double precision CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),
    source text NOT NULL,
    source_reference text,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS dynamic_observation_edge_type_idx
    ON public.dynamic_observation (road_edge_id, observation_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS dynamic_observation_expiry_idx
    ON public.dynamic_observation (valid_until);

-- The client must not read or write the road graph directly. Keep all data access
-- server-side; apply narrowly scoped grants/policies if a future frontend needs them.
ALTER TABLE public.dataset_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_edge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_restriction ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turn_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dynamic_observation ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.road_edge IS
    'Directional, homogeneous road segments for routing. Import one row per directed edge; preserve source/version provenance.';
COMMENT ON COLUMN public.road_edge.width_m IS
    'Measured roadway width where available; not a legal maximum vehicle width.';
COMMENT ON COLUMN public.road_edge.curve_severity IS
    'Approximate geometry-derived severity in [0,1]; not a vehicle maneuverability certification.';
COMMENT ON COLUMN public.road_edge.hazard_severity IS
    'Only for documented, sourced conditions/events; must not be interpreted as an accident-risk score.';
COMMENT ON COLUMN public.road_edge.closure_status IS
    'Distinguishes a verified closure/open snapshot from absence of closure information.';
