"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

/**
 * "Delete" from the user's point of view — actually a soft-hide
 * (DELETE /api/farms/:id sets `hidden`, never touches the underlying data).
 * Not rendered at all for the permanent demo farm (also enforced server-side).
 */
export function DeleteFarmButton({ farmId, farmName }: { farmId: string; farmName: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    if (!window.confirm(`Remove "${farmName}" from your farm list? Its data is kept, not deleted.`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/farms/${farmId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't remove this farm.");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't remove this farm.");
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      aria-label={`Remove ${farmName} from your farm list`}
      title="Remove from list (data is kept, not deleted)"
      className="rounded-full p-1.5 text-text-muted transition hover:bg-[var(--status-severe-tint)] hover:text-status-severe disabled:cursor-not-allowed disabled:opacity-50"
    >
      {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
    </button>
  );
}
