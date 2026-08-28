"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "@/components/Icon";
import {
  isSelfContained,
  modelName,
  partNamesFromMpd,
  slugFromFileName,
} from "@/ldraw/mpd";
import { putUpload } from "@/lib/uploadStore";

type Status =
  | { kind: "idle" }
  | { kind: "working"; detail: string }
  | { kind: "error"; message: string };

const ACCEPTED = /\.(ldr|mpd)$/i;

/**
 * Drop target for user models.
 *
 * A self-contained .mpd is loaded straight from the browser. A raw .ldr needs
 * the parts library to resolve its references, so it goes to /api/pack first.
 */
export function DropZone({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const depth = useRef(0);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED.test(file.name)) {
        setStatus({
          kind: "error",
          message: `${file.name} is not an .ldr or .mpd file.`,
        });
        return;
      }

      setStatus({ detail: "reading", kind: "working" });
      const text = await file.text();
      const slug = `local-${slugFromFileName(file.name)}`;
      const title = modelName(file.name);

      if (isSelfContained(text)) {
        putUpload({ partNames: partNamesFromMpd(text), slug, text, title });
        router.push(`/build/${slug}`);
        return;
      }

      setStatus({ detail: "resolving parts", kind: "working" });
      try {
        const response = await fetch("/api/pack", {
          body: JSON.stringify({ name: file.name, text }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const data = (await response.json()) as {
          mpd?: string;
          partNames?: Record<string, string>;
          missing?: string[];
          error?: string;
        };

        if (!(response.ok && data.mpd)) {
          setStatus({
            kind: "error",
            message: data.error ?? "This model could not be opened.",
          });
          return;
        }

        // Missing parts become a warning, not a dead end. The rest of the
        // model still builds.
        putUpload({
          missingParts: data.missing ?? [],
          partNames: data.partNames ?? {},
          slug,
          text: data.mpd,
          title,
        });
        router.push(`/build/${slug}`);
      } catch {
        setStatus({
          kind: "error",
          message: "Could not reach the packing service.",
        });
      }
    },
    [router]
  );

  // Accept a drop anywhere on the page, not just on the dashed box: people aim
  // at the window, not at a target.
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      depth.current += 1;
      setDragging(true);
    };
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setDragging(false);
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) {
        return;
      }
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      handleFile(event.dataTransfer.files[0]).catch(() => {
        setStatus({ kind: "error", message: "That file could not be read." });
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFile]);

  const working = status.kind === "working";

  return (
    <div className={`flex flex-col ${className}`}>
      {/*
        A strip rather than a card: bringing your own file is a real way in, but
        it is the one that presumes you already have an .ldr on disk, so it sits
        under the two that presume nothing and takes a line rather than a tile.
      */}
      <button
        className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 border border-edge border-dashed bg-panel px-5 py-4 text-left transition-colors hover:border-accent/70 hover:bg-accent/[0.06] disabled:opacity-60 data-[dragging=true]:border-accent data-[dragging=true]:bg-accent/15"
        data-dragging={dragging}
        disabled={working}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <h3 className="flex items-center gap-2 text-accent-fg text-sm">
          <Upload className="h-4 w-4" />
          {dragging ? "Release to open" : "Bring your own"}
        </h3>
        <p className="text-muted text-sm leading-relaxed">
          {working
            ? `Working: ${status.detail}…`
            : "Drop an .ldr or .mpd anywhere on this page, or click to browse."}
        </p>
        <p className="readout ml-auto text-faint">
          Packed .mpd opens instantly; a raw .ldr is resolved first
        </p>
      </button>

      <input
        accept=".ldr,.mpd"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            handleFile(file).catch(() => {
              setStatus({
                kind: "error",
                message: "That file could not be read.",
              });
            });
          }
        }}
        ref={inputRef}
        type="file"
      />

      {status.kind === "error" && (
        <p className="border-danger border-t bg-danger/5 px-5 py-3 text-ink text-sm">
          {status.message}
        </p>
      )}
    </div>
  );
}
