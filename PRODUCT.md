# Product

## Register

product

## Users

Cowd Edge serves developers and operators who need reliable user surfaces and external connectors for the Cowd AI harness. WebUI remains the primary browser console; message connectors and source connectors provide governed access to external conversations, callbacks, files, tables, and resource snapshots.

## Product Purpose

The product exists to connect Cowd Core to the outside world without pulling external UI stacks, platform SDKs, long-running protocol loops, or data-source drivers into the AI harness core. Success means each Edge unit can be discovered by Gateway, report health and degraded states, execute governed actions, expose evidence, and preserve parity with the core Gateway contracts without duplicating Runtime logic.

## Brand Personality

Calm, precise, operational. The interface should feel like a serious engineering console: dense enough for repeated work, explicit about state, and restrained in visual style.

## Anti-references

Do not make it a marketing landing page, decorative SaaS dashboard, card-heavy demo shell, or platform-specific admin clone. Avoid hiding backend gaps behind static mock panels, oversized hero areas, ornamental gradients, and one-off controls that do not map to Gateway contracts.

## Design Principles

- Gateway is the source of truth: every feature should be backed by a real endpoint, capability contract, or explicit unavailable state.
- Keep domains distinct: WebUI is a surface; Feishu/Email/WeCom/iLink are message connectors; Bitable/Base/table readers are source connectors.
- Preserve core purity: Edge units must not hold Cowd Runtime, Memory, Matrix, provider, or model lifecycle.
- Make health actionable: degraded states must explain source, impact, and next operation.
- Prefer structured work surfaces: lists, tables, timelines, details, forms, receipts, raw payload views, and previews should be consistent across domains.
- Keep action paths governed: write operations need preview, receipt, error recovery, and clear risk language.

## Accessibility & Inclusion

Target WCAG AA for text contrast, focus visibility, keyboard navigation, and reduced-motion behavior. Dense operational views must remain readable on common laptop screens and degrade predictably on narrower viewports.
