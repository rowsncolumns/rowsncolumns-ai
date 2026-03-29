import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthModalTrigger } from "@/components/auth-modal-trigger";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import type { Metadata } from "next";
import Image from "next/image";

const metrics = [
  { value: "6.2x", label: "Faster delivery on recurring spreadsheet work" },
  { value: "99.1%", label: "Task completion with audit trails attached" },
  { value: "< 3m", label: "Median turnaround for multi-step spreadsheet jobs" },
];

const featureCards = [
  {
    eyebrow: "Command center",
    title: "Prompt once. Ship a finished workbook, not a draft.",
    description:
      "RowsnColumns AI plans the job, edits the model, checks formulas, applies formatting, and leaves a change log your team can inspect.",
    points: [
      "Cell-level diff history on every run",
      "Formula-first editing instead of brittle text output",
      "Safe placement that avoids overwriting existing work",
    ],
  },
  {
    eyebrow: "Ops memory",
    title: "Turn repeated work into reusable playbooks.",
    description:
      "Save quarter-end reporting, board pack cleanup, or pipeline hygiene as templates with guardrails, reviewers, and source mappings.",
    points: [
      "Reusable workflows for teams",
      "Approval checkpoints before critical writes",
      "Context from your own source tables",
    ],
  },
  {
    eyebrow: "Executive view",
    title: "See progress, risk, and impact without asking for updates.",
    description:
      "A single timeline shows what ran, what changed, what failed, and what is ready for review across every team workflow.",
    points: [
      "Live queue and handoff status",
      "Usage analytics by workflow and operator",
      "Rollback-ready version checkpoints",
    ],
  },
];

const workflowSteps = [
  {
    id: "01",
    title: "Describe the outcome",
    text: "Tell RowsnColumns AI what needs to happen across the workbook, the data source, and the final output.",
  },
  {
    id: "02",
    title: "Watch the execution plan",
    text: "See the steps unfold in real time: sheets touched, formulas generated, formatting applied, and progress tracked.",
  },
  {
    id: "03",
    title: "Review and hand off",
    text: "The finished workbook, change log, and reusable workflow are ready for your team in one pass.",
  },
];

const proofMethodSteps = [
  {
    label: "Baseline run",
    detail:
      "Analyst executes the same workflow manually in the source workbook.",
  },
  {
    label: "Agent run",
    detail:
      "RowsnColumns AI executes with review checkpoints and audit trail enabled.",
  },
  {
    label: "Validation",
    detail:
      "Formula integrity, overwrite safety, and final workbook readiness are checked before handoff.",
  },
  {
    label: "Timing window",
    detail:
      "Elapsed time is measured from accepted prompt to review-ready workbook.",
  },
];

const proofMetricDefinitions = [
  {
    metric: "6.2x",
    detail:
      "Median manual turnaround time divided by median agent turnaround time.",
  },
  {
    metric: "99.1%",
    detail:
      "Benchmark runs that completed with an attached audit trail and no blocking validation failures.",
  },
  {
    metric: "< 3m",
    detail:
      "Median elapsed time from accepted prompt to review-ready workbook.",
  },
];

const proofEvidenceControls = [
  "All runs are executed with workbook validation enabled.",
  "Formula and overwrite checks must pass before a run is marked complete.",
  "Each run records cell-level changes for reviewer inspection.",
];

const collaborationCapabilities = [
  "Share a document link with teammates in one click.",
  "See edits sync live as collaborators update the workbook.",
  "Work alongside the agent while it writes, with humans and AI editing in parallel.",
  "Keep ownership controls so only authorized users can manage sharing.",
];

const collaborationGuardrails = [
  "Share links are generated per document and can be managed by the owner.",
  "Agent and user updates are applied to the same live workbook state.",
  "Workbook updates stream through a real-time shared state connection.",
  "Changes remain inside the same workbook context for faster handoff.",
];

const homeTitle = "AI Spreadsheet Workflows for Finance and Operations";
const homeDescription =
  "RowsnColumns AI helps finance and operations teams plan, edit, verify, and ship spreadsheet workflows with full audit trails.";

export const metadata: Metadata = {
  title: homeTitle,
  description: homeDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: homeTitle,
    description: homeDescription,
    url: "/",
    type: "website",
    images: [
      {
        url: "/demo-img.jpg",
        width: 2200,
        height: 1400,
        alt: "RowsnColumns AI workflow preview inside a spreadsheet",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: homeTitle,
    description: homeDescription,
    images: ["/demo-img.jpg"],
  },
};

function WorkflowPreviewCard() {
  return (
    <Card className="float-slow relative overflow-hidden border-black/10 bg-[#14161d] text-white shadow-[0_36px_90px_rgba(17,24,39,0.24)]">
      <div className="absolute inset-x-0 top-0 h-px bg-white/20" />
      <CardContent className="grid gap-4 p-4 sm:gap-5 sm:p-5 md:p-6">
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:px-4">
          <div>
            <p className="text-xs text-white/65 sm:text-sm">Workflow</p>
            <p className="display-font mt-0.5 text-lg sm:mt-1 sm:text-2xl">
              Board Pack Cleanup
            </p>
          </div>
          <Badge className="w-fit border-0 bg-[rgba(255,109,52,0.18)] text-[#ffd5c4]">
            Live run
          </Badge>
        </div>

        <div className="grid gap-3 sm:gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-white/10 bg-white/6 p-3 sm:rounded-[18px] sm:p-4">
            <div className="mb-3 flex items-center justify-between sm:mb-4">
              <p className="text-xs font-medium text-white/72 sm:text-sm">
                Execution plan
              </p>
              <span className="font-mono text-[10px] text-[#ffb394] sm:text-xs">
                05 steps
              </span>
            </div>
            <div className="space-y-2 text-xs sm:space-y-3 sm:text-sm">
              {[
                "Normalize ARR tabs and naming",
                "Repair broken formulas in summary sheet",
                "Apply CFO formatting template",
                "Flag missing assumptions",
                "Generate audit trail",
              ].map((step, index) => (
                <div
                  key={step}
                  className="glow-line flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.04] px-2 py-2 sm:gap-3 sm:rounded-xl sm:px-3 sm:py-3"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 font-mono text-[10px] text-[#ffb394] sm:h-8 sm:w-8 sm:rounded-lg sm:text-xs">
                    0{index + 1}
                  </div>
                  <span className="text-white/84">{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 sm:space-y-4">
            <div className="rounded-xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,109,52,0.22),rgba(255,109,52,0.06))] p-3 sm:rounded-[18px] sm:p-4">
              <p className="text-xs text-white/72 sm:text-sm">Cells updated</p>
              <p className="display-font mt-1 text-3xl sm:mt-2 sm:text-5xl">
                214
              </p>
              <p className="mt-2 text-xs text-white/72 sm:mt-3 sm:text-sm">
                Every cell is tracked, reversible, and tagged by reason.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/6 p-3 sm:rounded-[18px] sm:p-4">
              <p className="text-xs text-white/72 sm:text-sm">Risk scan</p>
              <div className="mt-3 space-y-2 sm:mt-4 sm:space-y-3">
                <div className="rounded-lg bg-[#1d2430] px-2 py-2 sm:rounded-xl sm:px-3 sm:py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#ffb394] sm:text-xs">
                    Warning
                  </p>
                  <p className="mt-1 text-xs text-white/82 sm:mt-2 sm:text-sm">
                    2 external links need confirmation before export.
                  </p>
                </div>
                <div className="rounded-lg bg-[#1d2430] px-2 py-2 sm:rounded-xl sm:px-3 sm:py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#8fd8b8] sm:text-xs">
                    Passed
                  </p>
                  <p className="mt-1 text-xs text-white/82 sm:mt-2 sm:text-sm">
                    No existing customer notes were overwritten.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSessionSafe();
  const initialUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : undefined;
  const initialIsAuthenticated = Boolean(initialUser);

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.22),transparent_42%)]" />

      <section className="px-5 pb-12 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="hero-grid overflow-hidden bg-[var(--card-bg)]">
            <div className="p-4 sm:p-6">
              <SiteHeader initialUser={initialUser} />

              <div className="grid gap-8 px-2 py-8 sm:gap-10 sm:py-10">
                <div className="rise-in text-center max-w-4xl flex flex-col items-center mx-auto">
                  <Badge className="mb-4 sm:mb-5">
                    AI operators for spreadsheet-heavy teams
                  </Badge>
                  <h1 className="display-font mx-auto text-2xl leading-tight font-semibold text-balance text-[var(--foreground)] sm:text-4xl md:text-5xl">
                    The fastest way to turn spreadsheet chaos into finished
                    work.
                  </h1>
                  <p className="mx-auto mt-4 text-base leading-7 text-[var(--foreground)] opacity-75 sm:mt-6 sm:text-lg sm:leading-8 ">
                    RowsnColumns AI plans, edits, verifies, and documents
                    complex spreadsheet work so finance and operations teams can
                    ship accurate outputs at production speed.
                  </p>

                  <div
                    className="mt-6 mx-auto inline-flex items-center justify-center gap-2 whitespace-nowrap sm:mt-8 sm:gap-3 lg:mx-0 lg:justify-start"
                    style={{ flexWrap: "nowrap" }}
                  >
                    <AuthModalTrigger
                      triggerText="Try for free"
                      mobileTriggerText="Try free"
                      authenticatedTriggerText="New spreadsheet"
                      mobileAuthenticatedTriggerText="New sheet"
                      initialIsAuthenticated={initialIsAuthenticated}
                      triggerVariant="hero"
                      redirectTo="/sheets/new"
                      className="h-11 shrink-0 px-4 text-sm whitespace-nowrap sm:h-12 sm:px-6 sm:text-base"
                    />
                    <div className="relative inline-flex w-fit shrink-0">
                      <Button
                        type="button"
                        disabled
                        aria-label="Excel Add-in (Coming soon)"
                        title="Excel Add-in (Coming soon)"
                        className="h-11 shrink-0 rounded-xl bg-[#217346] px-4 text-sm whitespace-nowrap text-white shadow-[0_18px_40px_rgba(33,115,70,0.3)] hover:bg-[#185C37] disabled:cursor-not-allowed disabled:bg-[#217346] disabled:opacity-100 sm:h-12 sm:px-6 sm:text-base"
                      >
                        Excel Add-in
                      </Button>
                      <span className="pointer-events-none absolute -right-10 -top-3 rounded-full border border-[#0f4d2f] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#185C37] shadow-sm sm:inline">
                        Coming soon
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rise-in-delayed">
                  <Card className="overflow-hidden bg-[var(--card-bg-solid)] shadow-[0_30px_80px_var(--card-shadow)]">
                    <CardContent className="p-3 sm:p-4">
                      <div className="overflow-hidden rounded-2xl border border-(--card-border) bg-(--sheet-bg)">
                        <Image
                          src="/demo-img.jpg"
                          alt="RowsnColumns AI spreadsheet workflow preview"
                          width={2200}
                          height={1400}
                          className="h-auto w-full object-cover"
                          priority
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <Badge variant="muted">Execution Preview</Badge>
            <h2 className="display-font mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:mt-4 sm:text-3xl md:text-4xl">
              See the workflow engine underneath the spreadsheet surface.
            </h2>
          </div>
          <WorkflowPreviewCard />
        </div>
      </section>

      <section id="platform" className="px-4 py-12 sm:px-8 sm:py-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <Badge variant="muted">Platform</Badge>
            <h2 className="display-font mt-4 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:mt-5 sm:text-4xl md:text-5xl">
              Built for teams that cannot afford mystery outputs.
            </h2>
            <p className="mt-3 text-base leading-7 text-[var(--muted-foreground)] sm:mt-4 sm:text-lg sm:leading-8">
              RowsnColumns AI combines structured planning, workbook-aware
              execution, and clear review states so every run feels reliable
              before it ever reaches an operator or approver.
            </p>
          </div>

          <div className="mt-8 grid gap-5 sm:mt-10 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((card) => (
              <Card
                key={card.title}
                className="h-full bg-[var(--card-bg-subtle)]"
              >
                <CardHeader className="p-5 sm:p-7 md:p-8">
                  <Badge variant="outline" className="w-fit">
                    {card.eyebrow}
                  </Badge>
                  <CardTitle className="display-font text-xl leading-tight tracking-[-0.03em] text-[var(--foreground)] sm:text-2xl md:text-3xl">
                    {card.title}
                  </CardTitle>
                  <CardDescription className="text-base">
                    {card.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {card.points.map((point) => (
                      <div
                        key={point}
                        className="flex items-start gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--feature-card-bg)] px-4 py-4"
                      >
                        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                          {point}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section
        id="collaboration"
        className="px-4 py-12 sm:px-8 sm:py-8 lg:px-12"
      >
        <div className="mx-auto max-w-7xl">
          <Card className="overflow-hidden border-black/10 bg-[linear-gradient(135deg,#111827_0%,#1f2937_55%,#2f1f1a_100%)] text-white shadow-[0_30px_80px_rgba(17,24,39,0.24)]">
            <div className="grid gap-6 p-5 sm:gap-8 sm:p-8 lg:grid-cols-[1.05fr_0.95fr] lg:p-10">
              <div>
                <Badge className="border-0 bg-white/10 text-white">
                  Collaboration
                </Badge>
                <h2 className="display-font mt-4 text-2xl font-semibold tracking-[-0.04em] sm:mt-5 sm:text-4xl md:text-5xl">
                  Share with your team and collaborate in real time.
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-white/74 sm:mt-4 sm:text-lg sm:leading-8">
                  Start in your own workspace, send a share link, and keep
                  everyone working from the same live workbook instead of
                  passing files back and forth.
                </p>

                <div className="mt-6 space-y-3 sm:mt-7 sm:space-y-4">
                  {collaborationCapabilities.map((item) => (
                    <div
                      key={item}
                      className="rounded-xl border border-white/10 bg-white/6 px-4 py-3"
                    >
                      <p className="text-sm leading-6 text-white/82 sm:text-base">
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:gap-5">
                <div className="rounded-[18px] border border-white/10 bg-white/6 p-4 sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ffd7c8]">
                    Live Session
                  </p>
                  <div className="mt-3 space-y-2">
                    {[
                      ["Vinay", "Owner", "Reviewing forecast assumptions"],
                      ["Aisha", "Finance", "Updating ARR bridge inputs"],
                      ["Ravi", "Ops", "Checking handoff notes"],
                    ].map(([name, role, status]) => (
                      <div
                        key={name}
                        className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#1f2937]/70 px-3 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {name}
                          </p>
                          <p className="text-xs uppercase tracking-[0.12em] text-white/58">
                            {role}
                          </p>
                        </div>
                        <p className="max-w-[180px] text-right text-xs leading-5 text-white/72">
                          {status}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,109,52,0.24),rgba(255,109,52,0.1))] p-4 sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ffd7c8]">
                    Collaboration Guardrails
                  </p>
                  <div className="mt-3 space-y-2">
                    {collaborationGuardrails.map((item) => (
                      <p
                        key={item}
                        className="rounded-lg border border-white/12 bg-[#1f2937]/45 px-3 py-2 text-xs leading-5 text-white/82"
                      >
                        {item}
                      </p>
                    ))}
                  </div>
                  <div className="mt-4">
                    <AuthModalTrigger
                      triggerText="Start collaborative workspace"
                      mobileTriggerText="Start collaboration"
                      authenticatedTriggerText="Open collaborative workspace"
                      mobileAuthenticatedTriggerText="Open workspace"
                      initialIsAuthenticated={initialIsAuthenticated}
                      triggerVariant="hero"
                      redirectTo="/sheets/new"
                      className="h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black shadow-[0_12px_28px_rgba(0,0,0,0.22)] hover:opacity-90"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="workflows" className="px-4 py-12 sm:px-8 sm:py-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl items-stretch gap-5 sm:gap-6 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          <Card className="h-full overflow-hidden border-black/5 bg-[linear-gradient(180deg,#121722_0%,#1b2230_100%)] text-white">
            <CardHeader className="p-5 pb-4 sm:p-8 sm:pb-6 lg:p-10 lg:pb-6">
              <Badge className="w-fit border-0 bg-white/10 text-white">
                Workflows
              </Badge>
              <CardTitle className="display-font text-2xl leading-tight tracking-[-0.03em] sm:text-3xl md:text-4xl">
                From one prompt to a finished deliverable in three clear steps.
              </CardTitle>
              <CardDescription className="max-w-md text-sm leading-6 text-white/74 sm:text-base sm:leading-7">
                Every workflow starts with intent, moves through a visible
                execution plan, and ends with a reviewed artifact your team can
                ship.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0 sm:p-8 sm:pt-0 lg:p-10 lg:pt-0">
              <div className="grid gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-1">
                {metrics.map((metric) => (
                  <div
                    key={metric.value}
                    className="rounded-[14px] border border-white/10 bg-white/6 p-4 sm:rounded-[18px] sm:p-6"
                  >
                    <p className="display-font text-3xl text-[#ffd7c8] sm:text-4xl md:text-5xl">
                      {metric.value}
                    </p>
                    <p className="mt-2 max-w-xs text-xs leading-5 text-white/72 sm:mt-3 sm:text-sm sm:leading-6">
                      {metric.label}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:gap-6">
            {workflowSteps.map((step) => (
              <Card
                key={step.id}
                className="bg-[var(--card-bg-solid)] shadow-[0_24px_60px_var(--card-shadow)]"
              >
                <CardContent className="flex h-full flex-col items-start gap-4 p-5 sm:flex-row sm:gap-6 sm:p-6 md:p-8">
                  <div className="display-font flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-lg font-semibold text-[var(--accent-foreground)] sm:h-16 sm:w-16 sm:rounded-[16px] sm:text-xl">
                    {step.id}
                  </div>
                  <div className="pt-0.5">
                    <h3 className="text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] sm:mt-2 sm:text-base sm:leading-7">
                      {step.text}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="proof" className="px-4 py-12 sm:px-8 sm:py-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="relative overflow-hidden border-black/10 bg-[linear-gradient(140deg,#111827_0%,#1f2937_45%,#2d1f1a_100%)] text-white shadow-[0_36px_90px_rgba(17,24,39,0.26)]">
            <div className="pointer-events-none absolute -left-16 top-1/4 h-44 w-44 rounded-full bg-[rgba(255,109,52,0.18)] blur-3xl" />
            <div className="pointer-events-none absolute -right-12 top-0 h-52 w-52 rounded-full bg-[rgba(143,216,184,0.12)] blur-3xl" />
            <CardContent className="relative grid gap-7 p-5 sm:gap-8 sm:p-8 lg:p-10">
              <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
                <div>
                  <Badge className="border-0 bg-white/10 text-white">
                    Benchmark Protocol
                  </Badge>
                  <h2 className="display-font mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl md:text-5xl">
                    Benchmark method behind the performance claims.
                  </h2>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-white/76 sm:text-lg sm:leading-8">
                    Every metric is produced from a repeatable runbook: the same
                    workflow is measured manually, then executed with
                    RowsnColumns AI under validation and audit controls.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {proofMetricDefinitions.map((item) => (
                    <div
                      key={item.metric}
                      className="rounded-2xl border border-white/12 bg-white/6 px-4 py-4 sm:px-5"
                    >
                      <p className="display-font text-3xl text-[#ffd7c8] sm:text-4xl">
                        {item.metric}
                      </p>
                      <p className="mt-1.5 text-xs leading-5 text-white/72 sm:text-sm sm:leading-6">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 sm:gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[20px] border border-white/10 bg-white/6 p-4 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <Badge className="border-0 bg-white/10 text-white">
                      Method Snapshot
                    </Badge>
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#ffb394] sm:text-xs">
                      04 stages
                    </span>
                  </div>
                  <h3 className="display-font mt-3 text-xl sm:text-2xl">
                    How each benchmark run is evaluated
                  </h3>
                  <div className="mt-5 space-y-3 sm:space-y-4">
                    {proofMethodSteps.map((item, index) => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-white/10 bg-[#1f2937]/70 px-3 py-3 sm:px-4 sm:py-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#ffb394]/45 bg-[#ff6d34]/24 font-mono text-[11px] text-[#ffd7c8] sm:h-8 sm:w-8 sm:text-xs">
                            0{index + 1}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white sm:text-base">
                              {item.label}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-white/72 sm:text-sm sm:leading-6">
                              {item.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-5 sm:gap-6">
                  <div className="rounded-[20px] border border-white/10 bg-white/6 p-4 sm:p-6">
                    <Badge className="border-0 bg-white/10 text-white">
                      Evidence Controls
                    </Badge>
                    <div className="mt-4 space-y-3">
                      {proofEvidenceControls.map((item) => (
                        <div
                          key={item}
                          className="rounded-xl border border-white/10 bg-[#1f2937]/70 p-4"
                        >
                          <p className="text-sm leading-6 text-white/78">
                            {item}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,109,52,0.24),rgba(255,109,52,0.1))] p-4 sm:p-6">
                    <p className="text-sm leading-6 text-white/82 sm:text-base sm:leading-7">
                      Benchmarks are run on recurring finance and operations
                      workflows in controlled pilot workspaces. Results vary by
                      workbook complexity, source quality, and review policy.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="security" className="px-4 py-12 sm:px-8 sm:py-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="overflow-hidden bg-[linear-gradient(135deg,#131822_0%,#1b2230_100%)] text-white">
            <div className="grid gap-6 p-5 sm:gap-8 sm:p-8 lg:grid-cols-[0.95fr_1.05fr] lg:p-10">
              <div>
                <Badge className="border-0 bg-white/10 text-white">
                  Security
                </Badge>
                <h2 className="display-font mt-4 text-2xl font-semibold tracking-[-0.04em] sm:mt-5 sm:text-4xl md:text-5xl">
                  Enterprise controls without enterprise drag.
                </h2>
                <p className="mt-3 max-w-xl text-base leading-7 text-white/72 sm:mt-5 sm:text-lg sm:leading-8">
                  Keep sensitive spreadsheet work inside authenticated workflows
                  with auditable changes, owner-managed sharing, and documented
                  security controls.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Badge className="border-0 bg-white/10 text-white">
                    Encrypted in transit
                  </Badge>
                  <Badge className="border-0 bg-white/10 text-white">
                    Owner-controlled sharing
                  </Badge>
                  <Badge className="border-0 bg-white/10 text-white">
                    Configurable retention policies
                  </Badge>
                </div>
                <p className="mt-4 text-xs leading-6 text-white/60 sm:text-sm">
                  Designed to support SOC 2 control mapping; certification and
                  scope depend on your organizational controls and deployment.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "Authenticated access",
                    "Signed-in users access documents through owner permission checks and share-token validation.",
                  ],
                  [
                    "Complete traceability",
                    "Track prompts, cell edits, formulas, and published artifacts across each run.",
                  ],
                  [
                    "Workspace boundaries",
                    "Keep reusable playbooks and workbook operations scoped to the workspace they belong to.",
                  ],
                  [
                    "Retention governance",
                    "Apply retention and deletion rules based on legal, operational, and customer requirements.",
                  ],
                ].map(([title, copy]) => (
                  <div
                    key={title}
                    className="rounded-[18px] border border-white/10 bg-white/6 p-5"
                  >
                    <p className="text-lg font-semibold">{title}</p>
                    <p className="mt-3 text-sm leading-6 text-white/70">
                      {copy}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="pricing" className="px-4 py-12 sm:px-8 sm:py-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="overflow-hidden bg-[linear-gradient(135deg,var(--pricing-gradient-start),var(--pricing-gradient-end))]">
            <div className="grid gap-6 p-5 sm:gap-8 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center lg:p-10">
              <div>
                <Badge>Pricing</Badge>
                <h2 className="display-font mt-4 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:mt-5 sm:text-4xl md:text-5xl">
                  Start with a team pilot, then scale by workflow.
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)] sm:mt-4 sm:text-lg sm:leading-8">
                  Launch with one team, prove the operational lift quickly, and
                  expand to more workflows once the review process is in place.
                </p>
              </div>

              <div className="rounded-[14px] border border-[var(--card-border)] bg-[#14161d] p-5 text-white shadow-[0_22px_60px_rgba(0,0,0,0.3)] sm:rounded-[18px] sm:p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-white/60 sm:text-sm">
                  Team Pilot
                </p>
                <p className="display-font mt-2 text-4xl sm:mt-3 sm:text-5xl">
                  $20
                </p>
                <p className="mt-1.5 text-xs text-white/70 sm:mt-2 sm:text-sm">
                  per workspace / month
                </p>
                <div className="mt-4 space-y-2 text-xs text-white/78 sm:mt-6 sm:space-y-3 sm:text-sm">
                  <p>Unlimited workflow runs</p>
                  <p>Shared templates and audit trails</p>
                  <p>Admin controls and approval gates</p>
                </div>
                <Button
                  className="mt-5 w-full cursor-not-allowed opacity-90 sm:mt-6"
                  type="button"
                  disabled
                  aria-label="Pilot pricing enrollment coming soon"
                  title="Pilot enrollment coming soon"
                >
                  Pilot enrollment coming soon
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
