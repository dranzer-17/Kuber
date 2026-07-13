import { requireManagerSession } from "@/lib/server/session";
import { TeamView } from "@/components/app/team-view";

export default async function TeamPage() {
  await requireManagerSession();
  return <TeamView />;
}
