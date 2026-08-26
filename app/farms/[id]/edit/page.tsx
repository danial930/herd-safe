import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { FarmForm } from "@/components/FarmForm";
import type { FarmFormInput } from "@/lib/farms/createFarm";

/** Edit Farm — PROJECT_GUIDE.md Section 4, screen 6. Reuses the Add Farm
 * form, pre-filled from the farm's existing checkpoints. */
export default async function EditFarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const farm = await prisma.farm.findUnique({ where: { id }, include: { checkpoints: true } });
  if (!farm) notFound();

  const farmCheckpoint = farm.checkpoints.find((c) => c.type === "FARM");
  const storageCheckpoint = farm.checkpoints.find((c) => c.type === "STORAGE");
  const transportCheckpoint = farm.checkpoints.find((c) => c.type === "TRANSPORT_ROUTE");
  const grazing = farmCheckpoint?.schedule as { start?: string; end?: string } | undefined;
  const transport = transportCheckpoint?.schedule as { departureTime?: string } | undefined;

  const initialValues: FarmFormInput = {
    name: farm.name,
    farmLatitude: farmCheckpoint?.latitude ?? 0,
    farmLongitude: farmCheckpoint?.longitude ?? 0,
    storageLatitude: storageCheckpoint?.latitude ?? 0,
    storageLongitude: storageCheckpoint?.longitude ?? 0,
    grazingStart: grazing?.start ?? "06:00",
    grazingEnd: grazing?.end ?? "18:00",
    transportDepartureTime: transport?.departureTime ?? "05:00",
    herdSize: farm.herdSize,
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href={`/farms/${id}`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to dashboard
      </Link>
      <h1 className="font-display mb-1 text-2xl font-semibold text-text-primary">Edit {farm.name}</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Only checkpoints whose coordinates or schedule actually change will re-pull fresh data — everything else
        resolves from cache instantly.
      </p>
      {farm.isDemoSeed ? (
        <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--status-mild-tint)", color: "var(--status-moderate)" }}>
          This is the permanent demo farm and can&apos;t be edited.
        </p>
      ) : (
        <FarmForm mode="edit" farmId={id} initialValues={initialValues} />
      )}
    </div>
  );
}
