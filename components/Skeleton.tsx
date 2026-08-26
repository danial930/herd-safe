export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-border-subtle ${className}`} />;
}

export function CheckpointCardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border-subtle bg-surface-raised p-5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="mb-1.5 h-3 w-16" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-6 w-28 rounded-full" />
    </div>
  );
}

export function FarmCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-5">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  );
}
