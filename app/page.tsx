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
import { SiteHeader } from "@/components/site-header";
import { siteNavigation } from "@/components/site-navigation";
import { auth } from "@/lib/auth/server";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";

const trustLogos = ["Stripe", "Mercury", "Ramp", "Vercel", "Notion", "Scale"];

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
    title: "Review the execution plan",
    text: "It proposes the sheets to touch, formulas to generate, formatting rules, and potential risks before running.",
  },
  {
    id: "03",
    title: "Approve and hand off",
    text: "The finished workbook, change log, and reusable workflow are ready for your team in one pass.",
  },
];

const stories = [
  {
    quote:
      "We went from hours of cleanup before every board meeting to a repeatable ten-minute workflow with full traceability.",
    name: "A. Patel",
    role: "Finance Systems Lead",
  },
  {
    quote:
      "The audit layer is the difference. It feels powerful enough for operators and controlled enough for managers.",
    name: "J. Morgan",
    role: "Head of RevOps",
  },
];

export const metadata: Metadata = {
  title: "AI Spreadsheet Workflows for Finance and Operations",
  description:
    "RowsnColumns AI helps finance and operations teams plan, edit, verify, and ship spreadsheet workflows with full audit trails.",
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
  const { data: session } = await auth.getSession();
  const initialUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : undefined;
  const cookieStore = await cookies();
  const hasAuthSessionCookie = cookieStore
    .getAll()
    .some((cookie) => cookie.name.endsWith(".session_token"));
  const initialIsAuthenticated = Boolean(initialUser || hasAuthSessionCookie);

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

                  <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:justify-center lg:justify-start">
                    <AuthModalTrigger
                      triggerText="Try for free"
                      authenticatedTriggerText="New spreadsheet"
                      initialIsAuthenticated={initialIsAuthenticated}
                      triggerVariant="hero"
                      redirectTo="/doc"
                    />
                  </div>
                </div>

                <div className="rise-in-delayed">
                  <Card className="overflow-hidden bg-[var(--card-bg-solid)] shadow-[0_30px_80px_var(--card-shadow)]">
                    <CardContent className="p-3 sm:p-4">
                      <div className="overflow-hidden rounded-[16px] border border-[var(--card-border)] bg-[var(--sheet-bg)]">
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

      <section id="platform" className="px-4 py-12 sm:px-8 sm:py-16 lg:px-12">
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

      <section id="workflows" className="px-4 py-12 sm:px-8 sm:py-16 lg:px-12">
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

      <section id="security" className="px-4 py-12 sm:px-8 sm:py-16 lg:px-12">
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
                  Keep sensitive spreadsheet work inside governed workflows with
                  clear approvals, auditable changes, and private workspace
                  memory.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Badge className="border-0 bg-white/10 text-white">
                    SOC 2-ready workflows
                  </Badge>
                  <Badge className="border-0 bg-white/10 text-white">
                    Role-based approvals
                  </Badge>
                  <Badge className="border-0 bg-white/10 text-white">
                    Zero-retention options
                  </Badge>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "Approval gates",
                    "Require human confirmation before any critical write or export event.",
                  ],
                  [
                    "Complete traceability",
                    "Track prompts, cell edits, formulas, and published artifacts across each run.",
                  ],
                  [
                    "Private knowledge",
                    "Keep reusable playbooks attached to the workspace they belong to.",
                  ],
                  [
                    "Controlled rollout",
                    "Ship workflows gradually with team-level permissions and review states.",
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

      <section id="pricing" className="px-4 py-12 sm:px-8 sm:py-16 lg:px-12">
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
                <Button className="mt-5 w-full sm:mt-6">Start Pilot</Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <footer className="px-4 pb-8 pt-4 sm:px-8 sm:pb-10 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 rounded-[14px] border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-4 text-xs text-[var(--muted-foreground)] sm:gap-4 sm:rounded-[18px] sm:px-6 sm:py-5 sm:text-sm md:flex-row md:items-center md:justify-between">
          <p>
            RowsnColumns AI. Built for spreadsheet-native teams that need speed
            with control.
          </p>
          <div className="flex flex-wrap gap-3 sm:gap-4">
            {siteNavigation.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="hover:text-[var(--foreground)]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
