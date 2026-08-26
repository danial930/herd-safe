"use client";

import { useState } from "react";
import { CheckpointCard } from "./CheckpointCard";
import { ChainConnector } from "./ChainConnector";
import { CheckpointDetailModal } from "./CheckpointDetailModal";
import type { CheckpointSummary } from "@/lib/farms/getCheckpointSummaries";

export function DashboardClient({ checkpoints }: { checkpoints: CheckpointSummary[] }) {
  const [selected, setSelected] = useState<CheckpointSummary | null>(null);

  return (
    <>
      <div className="flex flex-col items-stretch gap-1 lg:flex-row lg:items-center">
        {checkpoints.map((checkpoint, i) => (
          <div key={checkpoint.id} className="flex flex-1 flex-col items-stretch lg:flex-row lg:items-center">
            <div className="flex-1">
              <CheckpointCard checkpoint={checkpoint} onClick={() => setSelected(checkpoint)} />
            </div>
            {i < checkpoints.length - 1 && <ChainConnector />}
          </div>
        ))}
      </div>

      {selected && <CheckpointDetailModal checkpoint={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
