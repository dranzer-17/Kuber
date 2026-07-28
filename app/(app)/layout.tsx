import { AppProvider } from "@/lib/app-context";
import { getLeadsCount } from "@/lib/server/leads-count";
import { requireAppSessionContext } from "@/lib/server/session";
import { ThemedAppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Sequential rather than parallel: the lead count needs the company-scoped
  // client the session context resolves.
  const { session, db } = await requireAppSessionContext();
  const leadsTotal = await getLeadsCount(db);

  return (
    <AppProvider initialSession={session} initialLeadsTotal={leadsTotal}>
      <ThemedAppShell>{children}</ThemedAppShell>
    </AppProvider>
  );
}
