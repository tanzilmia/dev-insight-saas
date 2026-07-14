import { RepositoryCiDetail } from "@/components/repositories/repository-ci-detail";

export default async function RepositoryDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RepositoryCiDetail repositoryId={id} />;
}
