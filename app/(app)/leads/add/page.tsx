"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApolloForm, ExcelForm, ManualForm } from "@/components/app/lead-forms";
import { useApp } from "@/lib/app-context";
import { InfoTip } from "@/components/ui/info-tip";

// ── Step guide components ──────────────────────────────────────────────────────

interface Step {
  n: number;
  title: string;
  tip: string;
}

function StepGuide({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-center mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center min-w-0">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-2.5 py-1.5 shrink-0">
            <span className="size-4 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">
              {s.n}
            </span>
            <span className="text-[11px] font-medium text-foreground whitespace-nowrap">{s.title}</span>
            <InfoTip text={s.tip} side="bottom" />
          </div>
          {i < steps.length - 1 && (
            <span className="text-white text-[11px] px-1 shrink-0">→</span>
          )}
        </div>
      ))}
    </div>
  );
}

const EXCEL_STEPS: Step[] = [
  {
    n: 1,
    title: "Upload file",
    tip: "Upload any .xlsx or .csv export. The system automatically detects your header row even if there are blank rows at the top.",
  },
  {
    n: 2,
    title: "Map columns",
    tip: "Match your spreadsheet columns to platform fields. Email, First Name, and Company Domain are required. Auto-mapping handles common column names.",
  },
  {
    n: 3,
    title: "Preview & import",
    tip: "Review a sample of mapped leads before importing. Duplicates are automatically skipped based on email address.",
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AddLeadsPage() {
  const router = useRouter();
  const { session, loadLeads } = useApp();

  async function handleImport() {
    if (session) await loadLeads(session.access_token);
    router.push("/leads");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-8 py-5 border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center justify-center size-8 rounded-lg border border-border bg-transparent hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Go back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <h1 className="text-base font-bold">Add Leads</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Source leads via Apollo search, Excel/CSV upload, or manual entry.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-10 py-6">
        <div className="max-w-5xl mx-auto">
          <Tabs defaultValue="apollo" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6 max-w-sm">
              <TabsTrigger value="apollo">Apollo Search</TabsTrigger>
              <TabsTrigger value="excel">Excel / CSV</TabsTrigger>
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            </TabsList>

            <TabsContent value="apollo" className="mt-0">
              <ApolloForm onImport={handleImport} />
            </TabsContent>

            <TabsContent value="excel" className="mt-0">
              <StepGuide steps={EXCEL_STEPS} />
              <ExcelForm onImport={handleImport} />
            </TabsContent>

            <TabsContent value="manual" className="mt-0">
              <ManualForm onImport={handleImport} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
