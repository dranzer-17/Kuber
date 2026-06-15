export default function Loading() {
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
