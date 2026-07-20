# Implementation plan: meaningful landing page

1. Replace the hero-only `apps/web/src/app/page.tsx` content with the approved
   Signal → Story structure: hero/product preview, proof strip, workflow,
   outcomes, capabilities, and closing CTA.
2. Keep all static content and icon references module-level; use existing
   `PublicNav`, `/login`, `/dashboard`, and `#how-it-works` routes only.
3. Add small landing-specific CSS utilities for the grid atmosphere, signal
   preview details, focus states, and reduced-motion-safe reveal polish.
4. Run web lint, web typecheck, and the production build; inspect the diff and
   verify the working tree is clean.
