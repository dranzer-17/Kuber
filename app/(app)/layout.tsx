import { AppProvider } from "@/lib/app-context";
import { getLeadsCount } from "@/lib/server/leads-count";
import { requireAppSession } from "@/lib/server/session";
import { ThemedAppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, leadsTotal] = await Promise.all([
    requireAppSession(),
    getLeadsCount(),
  ]);

  return (
    <AppProvider initialSession={session} initialLeadsTotal={leadsTotal}>
      <ThemedAppShell>{children}</ThemedAppShell>
    </AppProvider>
  );
}
