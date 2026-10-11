# Project instructions

## Git workflow

- Work on the `davide` branch.
- After cohesive changes have been verified, commit and push to `origin davide`, as requested by the project owner.
- Preserve unrelated work. Do not force-push or rewrite published history.

## Frontend boundaries

- Keep backend JSON contracts in `client/src/lib/api/`, separate from domain types and components.
- Routing is backend-owned. Demo data must remain explicit and never replace failed real requests automatically.
- Itineraries are ordered stop lists; the v1 API currently supports exactly two stops. Never silently discard extra deliveries.
