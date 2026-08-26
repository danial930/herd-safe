import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FarmForm } from "@/components/FarmForm";

/** Add Farm form — PROJECT_GUIDE.md Section 4, screen 2. */
export default function NewFarmPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All Farms
      </Link>
      <h1 className="font-display mb-1 text-2xl font-semibold text-text-primary">Add a farm</h1>
      <p className="mb-6 text-sm text-text-secondary">
        We&apos;ll pull current real conditions for the pasture, transport route, and storage checkpoints. Multi-year
        historical backtesting isn&apos;t run automatically here — it&apos;s a separate, deliberate step against a
        specific checkpoint once you&apos;re ready to spend the credits on it.
      </p>
      <FarmForm mode="create" />
    </div>
  );
}
