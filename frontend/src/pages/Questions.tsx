import { DashboardShell } from "@/components/DashboardShell";
import { QuestionRights } from "@/components/QuestionRights";
import { STUDENT_NAV } from "@/lib/nav";

export default function Questions() {
  return (
    <DashboardShell title="Sorularım" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-3xl pb-12">
        <QuestionRights />
      </div>
    </DashboardShell>
  );
}
