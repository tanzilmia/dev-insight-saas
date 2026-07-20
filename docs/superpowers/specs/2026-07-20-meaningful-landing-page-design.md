# Meaningful DevInsight landing page

## Goal

Turn the current hero-only home page into a clear, English-language product story
for engineering managers and team leads. The page should explain what DevInsight
does, why it matters, how it works, and what a visitor should do next without
requiring dashboard access first.

## Product narrative

The page will follow the story “Signal → Story”: DevInsight collects engineering
signals from GitHub and code-quality tooling, then turns them into an accurate,
manager-ready view of delivery, contribution, quality, and risk.

Primary message:

> Turn engineering activity into a story your team can act on.

Supporting copy will explain that DevInsight replaces manual status chasing with
organization-aware engineering visibility, AI-assisted reports, contributor
mapping, and quality signals.

## Page structure

1. **Navigation** — preserve the current brand, Login, Dashboard, and theme
   control, with a slightly stronger sticky/floating treatment.
2. **Hero** — new headline, supporting copy, `Get started` primary CTA and `See
   how it works` secondary anchor CTA. The right side becomes a cohesive
   “Engineering Signal” product preview instead of three generic feature cards.
3. **Proof strip** — four compact trust/value signals: GitHub App connected,
   AI-assisted reports, SonarQube quality signals, and role-aware by default.
4. **Workflow section** — four numbered steps: Connect, Collect, Understand,
   Act. This makes the product flow concrete.
5. **Outcome section** — three cards focused on replacing status chasing,
   spotting delivery risk, and recognizing invisible engineering work.
6. **Product capabilities** — six cards covering activity intelligence,
   contributor mapping, code quality, AI reports, secure workspace, and
   automated CI.
7. **Closing CTA** — a visually distinct callout ending with “Give every
   engineering decision better signal.” and a clear `Get started` action.

## Visual direction

Keep the existing dark navy / indigo product language, but use it with more
editorial rhythm and less repeated gradient treatment:

- a subtle grid/aurora background layer for atmosphere;
- generous section spacing and asymmetric content widths;
- indigo as a focused accent, with emerald/amber/red reserved for signal states;
- cards that resemble a calm engineering operations console;
- restrained entrance motion and hover states, disabled under reduced-motion;
- responsive layouts that collapse to one column without losing hierarchy;
- accessible headings, landmarks, link labels, focus states, and sufficient color
  contrast.

No new package or remote asset is required. Use existing CSS variables, Tailwind
utilities, Lucide icons, and the existing `PublicNav` component.

## Implementation boundaries

- Update only the public home page and any small, landing-specific CSS additions
  needed in `globals.css`.
- Keep all CTAs as existing local routes (`/login`, `/dashboard`, and an in-page
  `#how-it-works` anchor); no new backend behavior.
- Keep the home page static and avoid client-side state or data fetching.
- Hoist static content arrays and icon references outside the component.
- Preserve the existing theme provider and light/dark mode behavior.

## Verification

- Check the page at desktop, tablet, and mobile widths.
- Confirm all CTAs and the workflow anchor work.
- Verify reduced-motion behavior and keyboard-visible focus states.
- Run web lint, web typecheck, and the production build.

## Non-goals

- No pricing, testimonials, customer logos, or unsupported performance claims.
- No changes to authenticated dashboard pages.
- No new image generation or external image dependency.
