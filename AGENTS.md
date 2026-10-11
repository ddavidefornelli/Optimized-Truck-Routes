# Project instructions

## Git workflow

- Work on the `davide` branch.
- After cohesive changes have been verified, commit and push to `origin davide`, as requested by the project owner.
- Preserve unrelated work. Do not force-push or rewrite published history.

## Design direction

- The client is **Valio Aimo**. Reference: https://www.valioaimo.fi/en/become-a-customer/delivery-wholesale/.
- Use its visual identity: petrol `#005670`, dark petrol `#003747`, lime `#C0E021` (hover `#ABC80B`), light background `#F2F7F8`, white surfaces. Reserve lime for the main action; keep text and map routes high-contrast petrol.
- UI languages are **Finnish (default)** and **English**, selected with FI / EN and persisted locally. Localize accessibility labels, validation, app-owned errors, map guidance, demo warnings and number formatting too. Keep backend-authored text intact when no translation is defined. Address search must request the selected language. Do not add Italian as a UI language.
- Keep the UI extremely minimal and driver-oriented: readable labels, large touch targets (at least 44px), clear primary action, map and essential trip information. Avoid promotional imagery, decorative dashboards, and unnecessary controls.
- The official petrol logo is stored locally at `client/public/valio-aimo.svg`, sourced from https://cdn-wp.valio.fi/valio-wp-network/sites/2/2025/06/Valio_Aimo_logo_petrooli_RGB-1.svg. Use system sans-serif fonts rather than copying licensed brand fonts.

## Frontend boundaries

- Keep backend JSON contracts in `client/src/lib/api/`, separate from domain types and components.
- Routing is backend-owned. Demo data must remain explicit and never replace failed real requests automatically.
- Itineraries are ordered stop lists; the v1 API currently supports exactly two stops. Never silently discard extra deliveries.
