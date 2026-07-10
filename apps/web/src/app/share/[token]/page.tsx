import { SharedReport } from "@/components/reports/shared-report";

export default async function SharedReportPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedReport token={token} />;
}
