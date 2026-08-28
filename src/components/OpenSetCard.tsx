"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Search, Spinner } from "@/components/Icon";
import { SetCombobox } from "@/components/SetCombobox";
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
 * The line under the field: the licence note, what is happening, or what went
 * wrong.
 *
 * All three are written to about the same length. The card sits in a grid row
 * whose height is its own, so a note that grows by a line while a set is being
 * fetched moves everything under it, and the thing being moved is a button
 * somebody may be about to press.
 */
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
        ? "Fetching every part this set uses. Only the first open is slow."
        : "Redistributable under CC BY 2.0, credited to whoever built it."}
    </p>
  );
}

/**
 * A few sets to press rather than type.
 *
 * An empty search field is a question with 1,470 answers, and someone who has
 * never opened an LDraw file has no reason to know that "10220" is one of them.
 * These are small enough to pack quickly and famous enough to be worth a click.
 */
const SUGGESTIONS: readonly { label: string; setId: string }[] = [
  { label: "Camper Van", setId: "10220-1" },
  { label: "Opera House", setId: "21012-1" },
  { label: "Mini Falcon", setId: "4488-1" },
];

/**
 * Open any set from the LDraw Official Model Repository.
 *
 * The OMR holds about 1,470 official sets, far more than is worth committing,
 * so only a couple ship with the app and the rest are a search away. The fetch
 * goes through /api/omr because the OMR serves no CORS headers and the set
 * still has to be packed before it can load. That packing is what makes the
 * first open of a set slow, hence the note the card shows while it works.
 */
export function OpenSetCard({
  className = "",
  featured = false,
}: {
  className?: string;
  /** The front page's headline way in, given the room to look like one. */
  featured?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const working = status.kind === "working";

  const openSet = useCallback(
    async (raw: string) => {
      const set = raw.trim();
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

        const setId = data.setId ?? set;
        const slug = `local-omr-${setId}`;
        putUpload({
          // OMR sets are CC BY through the CCAL header the route checked for, so
          // the author travels with the model and the viewer shows it.
          credit: data.author
            ? `${data.author}, LDraw OMR (CC BY 2.0)`
            : "LDraw OMR (CC BY 2.0)",
          missingParts: data.missing ?? [],
          partNames: data.partNames ?? {},
          slug,
          text: data.mpd,
          title: setId,
        });
        router.push(`/build/${slug}`);
      } catch {
        setStatus({
          kind: "error",
          message: "Could not reach the set service.",
        });
      }
    },
    [router]
  );

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <form
        className={`flex h-full w-full flex-col justify-between gap-6 shadow-[0_0_0_1px_var(--color-edge)] ${
          featured ? "bg-panel-raised p-6 sm:p-8" : "bg-panel p-5"
        }`}
        onSubmit={(event) => {
          event.preventDefault();
          openSet(value);
        }}
      >
        <div>
          <h3
            className={`flex items-center gap-2 text-ink ${
              featured ? "text-xl" : "text-base"
            }`}
          >
            <Search
              className={featured ? "h-5 w-5 text-accent-fg" : "h-4 w-4"}
            />
            Open an official set
          </h3>
          <p
            className={`mt-2 max-w-lg text-muted leading-relaxed ${
              featured ? "text-base" : "text-sm"
            }`}
          >
            Around 1,470 sets are in the LDraw Official Model Repository. Search
            by number or name to build one.
          </p>

          <div className={`flex gap-2 ${featured ? "mt-5" : "mt-3"}`}>
            <SetCombobox
              disabled={working}
              large={featured}
              onChange={setValue}
              onPick={openSet}
              value={value}
            />
            <button className="hud-button" disabled={working} type="submit">
              {working ? (
                <>
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  Opening
                </>
              ) : (
                "Open"
              )}
            </button>
          </div>

          {/*
            The suggestions and the progress bar share one row, and the row is
            never emptied: the chips are hidden rather than unmounted, so they
            go on holding the height while the bar sits over them. Nothing is
            lost by hiding them, because once a set is being fetched there is
            nothing left to choose.
          */}
          {featured || working ? (
            <div className="relative mt-3">
              <div
                className={`flex flex-wrap items-center gap-2 ${
                  working ? "invisible" : ""
                }`}
              >
                <span className="label">Try</span>
                {SUGGESTIONS.map((set) => (
                  <button
                    className="hud-button"
                    key={set.setId}
                    onClick={() => {
                      setValue(set.setId);
                      openSet(set.setId);
                    }}
                    type="button"
                  >
                    {set.label}
                  </button>
                ))}
              </div>

              {working ? (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
                  <div className="progress-track h-0.5 w-full" />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <StatusNote status={status} />
      </form>
    </div>
  );
}
