import { CheckpointCardSkeleton, Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Skeleton className="mb-6 h-4 w-24" />
      <Skeleton className="mb-6 h-8 w-72" />
      <Skeleton className="mb-8 h-28 w-full rounded-2xl" />
      <div className="flex flex-col gap-4 lg:flex-row">
        {Array.from({ length: 3 }).map((_, i) => (
          <CheckpointCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
