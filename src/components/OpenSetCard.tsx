"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "@/components/Icon";
import { putUpload } from "@/lib/uploadStore";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string };

interface SetResponse {
  author?: string | null;
  error?: string;
  missing?: string[];
  mpd?: string;
  partNames?: Record<string, string>;
  setId?: string;
}

/**
 * Open any set from the LDraw Official Model Repository by number.
 *
 * The OMR holds about 1,470 official sets, far more than is worth committing,
 * so only a couple ship with the app and the rest are a set number away. The
 * fetch goes through /api/omr because the OMR serves no CORS headers and the
 * set still has to be packed against the parts library before it can load.
 * That packing is what makes the first open of a set slow, hence the note the
 * card shows while it works.
 */
/** The line under the field: the licence note, progress, or what went wrong. */
function StatusNote({ status }: { status: Status }) {
  if (status.kind === "error") {
    return (
      <p className="readout border-danger border-t pt-3 text-ink">
        {status.message}
      </p>
    );
  }
  return (
    <p className="readout border-edge border-t pt-3 text-faint">
      {status.kind === "working"
        ? "Fetching every part this set uses. The first time a set is opened takes a few seconds; after that it is immediate."
        : "Redistributable under CC BY 2.0, credited to whoever built it."}
    </p>
  );
}

export function OpenSetCard({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const working = status.kind === "working";

  const open = async (event: React.FormEvent) => {
    event.preventDefault();
    const set = value.trim();
    if (!set) {
      return;
    }

    setStatus({ kind: "working" });
    try {
      const response = await fetch(`/api/omr/${encodeURIComponent(set)}`);
      const data = (await response.json()) as SetResponse;

      if (!(response.ok && data.mpd)) {
        setStatus({
          kind: "error",
          message: data.error ?? "That set could not be opened.",
        });
        return;
      }

      const slug = `local-omr-${data.setId ?? set}`;
      putUpload({
        missingParts: data.missing ?? [],
        partNames: data.partNames ?? {},
        slug,
        text: data.mpd,
        title: `${data.setId ?? set}${data.author ? ` by ${data.author}` : ""}`,
      });
      router.push(`/build/${slug}`);
    } catch {
      setStatus({ kind: "error", message: "Could not reach the set service." });
    }
  };

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <form
        className="flex h-full w-full flex-col justify-between gap-6 bg-panel p-5 shadow-[0_0_0_1px_var(--color-edge)]"
        onSubmit={open}
      >
        <div>
          <h3 className="flex items-center gap-2 text-base text-ink">
            <Search className="h-4 w-4" />
            Open an official set
          </h3>
          <p className="mt-2 text-muted text-sm leading-relaxed">
            Around 1,470 sets are in the LDraw Official Model Repository. Enter
            a set number to build one.
          </p>

          <div className="mt-3 flex gap-2">
            <input
              aria-label="LEGO set number"
              className="readout min-w-0 flex-1 border border-edge bg-panel-raised px-2 py-1.5 text-ink placeholder:text-faint"
              disabled={working}
              inputMode="numeric"
              onChange={(event) => setValue(event.target.value)}
              placeholder="e.g. 10220"
              value={value}
            />
            <button className="hud-button" disabled={working} type="submit">
              {working ? "Opening" : "Open"}
            </button>
          </div>
        </div>

        <StatusNote status={status} />
      </form>
    </div>
  );
}
