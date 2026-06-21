# WebUI SurfaceHost Alignment Plan

## Target

This phase makes WebUI a first-class Gateway surface. WebUI must use the current Gateway contracts directly, expose SurfaceHost registry and dispatch operations, align Runtime with backend growth endpoints, and remove stale browser-side token and command API paths.

## Scope

1. Replace WebUI command calls from `/api/commands/*` with `/api/slash/*`.
2. Add WebUI client coverage for `/api/surfaces/*`.
3. Add a SurfaceHost page for registry, health, routes, resources, events, send, and action dispatch.
4. Add a SurfaceHost summary to Gateway so the external ingress plane is visible beside connectors and cross-plane governance.
5. Keep WebUI as an internal same-origin Gateway surface. Browser pages do not manage or inject bearer tokens; external API clients still use the single Gateway authorization boundary.
6. Add Runtime growth-loop visibility from `/api/growth/status` and `/api/growth/events`; WebUI should display backend learning evidence instead of hiding it in generic payloads.
7. Update capability metadata, navigation, route audit, and tests so this stays enforced.

## Acceptance

- WebUI has a `/surfaces` route and navigation entry.
- `api.commands`, `api.commandHistory`, `api.resolveCommand`, and `api.executeCommand` call slash endpoints only.
- No production source or gate script references `/api/commands`.
- WebUI API calls do not read or attach browser-stored bearer tokens.
- Gateway allows same-origin WebUI browser requests while keeping cross-site and ordinary external API calls on the Bearer boundary.
- Runtime page shows growth status, events, promotion receipts, and raw detail from the real Gateway growth endpoints.
- Unit tests cover SurfaceHost client methods and page rendering.
- Unit tests cover internal Gateway access verification and Runtime growth-loop rendering.
- `npm test` and `npm run build` pass.
