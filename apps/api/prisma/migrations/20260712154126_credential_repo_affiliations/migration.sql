-- AlterTable
ALTER TABLE "GitCredential" ADD COLUMN     "repoAffiliations" TEXT NOT NULL DEFAULT 'owner,collaborator,organization_member';
