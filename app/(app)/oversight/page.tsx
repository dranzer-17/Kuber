import { requireManagerSession } from "@/lib/server/session";
import { OversightView } from "@/components/app/oversight-view";

export default async function OversightPage() {
  await requireManagerSession();
  return <OversightView />;
}
