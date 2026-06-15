export default function Loading() {
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
