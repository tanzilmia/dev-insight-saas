declare module "../../../../scripts/rotate-local-security-secrets.mjs" {
  export function rotateEnvText(source: string): string;
}

declare module "../../../../scripts/rotate-prod-openclaw-secrets.mjs" {
  export function rotateOpenClawEnvText(source: string): string;
}
