import { Suspense } from "react";
import { UniboxClient } from "./unibox-client";

export default function UniboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading Unibox…</div>}>
      <UniboxClient />
    </Suspense>
  );
}
