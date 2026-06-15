export default function Loading() {
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
