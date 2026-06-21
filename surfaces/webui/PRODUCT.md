# Product

## Register

product

## Users

Cowd WebUI serves developers and operators who need a browser-based control surface for the Cowd AI harness. They use it to inspect Gateway health, sessions, runtime state, agents, tools, memory, context, skills, governance, and surface integrations while work is running.

## Product Purpose

The product exists to expose Gateway's complete operational capability through a clear, trustworthy web console. Success means the browser UI can discover backend capability, show health and degraded states, execute governed actions, inspect raw payloads when needed, and keep WebUI/TUI parity without duplicating backend logic.

## Brand Personality

Calm, precise, operational. The interface should feel like a serious engineering console: dense enough for repeat work, explicit about state, and restrained in visual style.

## Anti-references

Do not make it a marketing landing page, decorative SaaS dashboard, card-heavy demo shell, or surface-specific platform UI. Avoid hiding backend gaps behind static mock panels, oversized hero areas, ornamental gradients, and one-off controls that do not map to Gateway contracts.

## Design Principles

- Gateway is the source of truth: every feature should be backed by a real endpoint, capability contract, or explicit unavailable state.
- Preserve parity: WebUI and TUI should expose the same core Gateway capabilities, with WebUI using richer layout where it genuinely helps.
- Make health actionable: degraded states must explain source, impact, and next operation.
- Prefer structured work surfaces: lists, tables, timelines, details, forms, receipts, and raw payload views should be consistent across domains.
- Keep action paths governed: write operations need preview, receipt, error recovery, and clear risk language.

## Accessibility & Inclusion

Target WCAG AA for text contrast, focus visibility, keyboard navigation, and reduced-motion behavior. Dense operational views must remain readable on common laptop screens and degrade predictably on narrower viewports.
