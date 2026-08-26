import { FarmCardSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 h-10 w-64" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <FarmCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
