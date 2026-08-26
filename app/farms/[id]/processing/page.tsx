import { ProcessingView } from "@/components/ProcessingView";

/** Processing screen — PROJECT_GUIDE.md Section 4, screen 3. */
export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-xl px-6">
      <ProcessingView farmId={id} />
    </div>
  );
}
