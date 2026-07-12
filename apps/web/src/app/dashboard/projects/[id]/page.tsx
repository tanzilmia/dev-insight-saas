import { ProjectDetailPage } from "@/components/projects/project-detail";

export default async function ProjectDetailsRoute({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetailPage projectId={id} />;
}
