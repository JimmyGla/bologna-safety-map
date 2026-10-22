import { LangProvider } from "@/components/i18n";
import { ReportView } from "@/components/report/ReportView";
import { errInfo, logger } from "@/lib/log";
import { parseRange, type Report } from "@/lib/report/aggregate";

// Public statistics from the anonymous archive (archived_events, archive_levels).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Report · Bologna Safety Map",
  description: "Statistiche anonime su proteste e violenza in strada a Bologna / Anonymous statistics",
};

export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = parseRange((await searchParams).days);
  let report: Report | null = null;
  try {
    const { loadReport } = await import("@/lib/report/data");
    report = await loadReport(range);
  } catch (err) {
    logger("report").error(errInfo(err), "report failed");
  }
  return (
    <LangProvider>
      <ReportView report={report} range={range} />
    </LangProvider>
  );
}
