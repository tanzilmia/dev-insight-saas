import { z } from "zod";

const organizationId = z.string().min(1);
const token = z.string().trim().min(20).max(255);

export const listCredentialsQuerySchema = z.object({
  organizationId
});

export const resolveUserQuerySchema = z.object({
  organizationId,
  username: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.replace(/^@+/, ""))
});

export const credentialParamsSchema = z.object({
  id: z.string().min(1)
});

export const createCredentialSchema = z.object({
  organizationId,
  // Only GitHub is supported in the MVP; the enum leaves room for more.
  provider: z.enum(["GITHUB"]).default("GITHUB"),
  token
});

export const reconnectCredentialSchema = z.object({
  token
});

// Repo-access setting: which affiliations "Sync from GitHub" lists. At least
// one must stay selected or the sync list would always be empty.
export const updateRepoAccessSchema = z.object({
  repoAffiliations: z
    .array(z.enum(["owner", "collaborator", "organization_member"]))
    .min(1)
});
