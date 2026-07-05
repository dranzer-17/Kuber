export function DashboardSkeleton() {
  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto animate-pulse">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-3 w-16 bg-secondary rounded mb-2" />
          <div className="h-7 w-32 bg-secondary rounded" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="h-8 w-8 bg-secondary rounded-lg" />
            <div className="h-8 w-16 bg-secondary rounded" />
            <div className="h-3 w-24 bg-secondary rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-6 h-72" />
        <div className="bg-card border border-border rounded-xl p-6 h-72" />
      </div>
    </div>
  );
}

export function LeadsSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      <div className="flex items-center justify-between px-8 py-4 border-b border-border">
        <div className="h-6 w-32 bg-secondary rounded" />
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-secondary rounded-lg" />
          <div className="h-8 w-24 bg-secondary rounded-lg" />
        </div>
      </div>
      <div className="flex-1 px-8 py-5">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <div className="size-4 rounded bg-secondary" />
                <div className="size-8 rounded-full bg-secondary" />
                <div className="h-3 bg-secondary rounded flex-1" />
                <div className="h-5 w-16 bg-secondary rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CampaignsSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-36 bg-secondary rounded mb-2" />
          <div className="h-3 w-48 bg-secondary rounded" />
        </div>
        <div className="h-9 w-32 bg-secondary rounded-lg" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 bg-card border rounded-xl h-20" />
        ))}
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 animate-pulse">
      <div className="h-7 w-28 bg-secondary rounded mb-6" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="h-4 w-32 bg-secondary rounded" />
          <div className="h-9 w-full bg-secondary rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function RouteSkeleton({ href }: { href: string }) {
  if (href.startsWith("/settings")) return <SettingsSkeleton />;
  if (href.startsWith("/campaigns")) return <CampaignsSkeleton />;
  if (href.startsWith("/unibox")) return <CampaignsSkeleton />;
  if (href.startsWith("/leads")) return <LeadsSkeleton />;
  return <DashboardSkeleton />;
}
