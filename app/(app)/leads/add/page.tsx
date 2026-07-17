"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/lib/app-context";

// The Add Leads flow now lives in one place — the shared `AddLeadsDrawer`
// modal rendered by the app shell — instead of being duplicated here as a
// second full-page copy of the same Apollo/Excel/Manual forms. This route is
// kept only so existing bookmarks/links still work: it opens that shared
// modal and redirects back to the leads list.
export default function AddLeadsPage() {
  const router = useRouter();
  const { role, loadingSession, setShowAddLeads } = useApp();

  useEffect(() => {
    if (loadingSession) return;
    if (role === "manager") setShowAddLeads(true);
    router.replace("/leads");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSession, role]);

  return null;
}
