import Link from "next/link";
import { DropZone } from "@/components/DropZone";
import { OpenSetCard } from "@/components/OpenSetCard";
import { ResumeBadge } from "@/components/ResumeBadge";
import { LegalFooter } from "@/components/shell/LegalFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getManifest } from "@/lib/manifest";

export default async function GalleryPage() {
  const models = await getManifest();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-edge border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-14">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span aria-hidden className="h-3 w-3 bg-brick-red" />
              <span aria-hidden className="h-3 w-3 bg-brick-yellow" />
              <span aria-hidden className="h-3 w-3 bg-brick-blue" />
              <h1 className="font-mono text-lg uppercase tracking-[0.2em]">
                LDraw Builder
              </h1>
            </div>
            <ThemeToggle />
          </div>

          <p className="max-w-2xl text-2xl text-ink leading-snug">
            Tip the bricks onto the floor and watch a model assemble itself, one
            build step at a time. Or tip them out and build it yourself.
          </p>
          <p className="max-w-2xl text-muted text-sm leading-relaxed">
            Every model is an LDraw file rendered with three.js. Follow the
            authored build order, explode the finished model to see how it fits
            together, slice it open layer by layer, or click any single brick to
            find out what it is. In build mode the pile is a live physics
            simulation: dig through it, throw pieces aside, and drop each one
            into its slot. Progress is kept in this browser, so a long set can
            be picked up where you left it.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="label">Models</h2>
          <span className="readout text-faint">{models.length} available</span>
        </div>

        {models.length === 0 && <EmptyState />}

        <ul className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => (
            <li className="relative" key={model.slug}>
              <Link
                className="group flex h-full flex-col justify-between gap-6 bg-panel p-5 shadow-[0_0_0_1px_var(--color-edge)] transition-colors hover:bg-panel-raised"
                href={`/build/${model.slug}`}
              >
                <div>
                  <h3 className="text-base text-ink transition-colors group-hover:text-accent-fg">
                    {model.title}
                  </h3>
                  {model.blurb ? (
                    <p className="mt-2 text-muted text-sm leading-relaxed">
                      {model.blurb}
                    </p>
                  ) : null}
                </div>

                <div>
                  <dl className="flex gap-6 border-edge border-t pt-3">
                    <Stat label="Bricks" value={model.bricks} />
                    <Stat label="Steps" value={model.steps} />
                    <Stat label="Unique" value={model.uniqueParts} />
                  </dl>
                  <p className="readout mt-3 max-w-[70%] text-faint">
                    {model.credit}
                  </p>
                </div>
              </Link>
              <ResumeBadge slug={model.slug} steps={model.steps} />
            </li>
          ))}

          {/* Last cell, so opening a model and adding one are the same gesture
              in the same place. With four bundled models it also fills the gap
              the grid would otherwise leave. */}
          <li>
            <OpenSetCard />
          </li>

          <li>
            <DropZone />
          </li>
        </ul>

        <p className="mt-4 max-w-2xl text-muted text-sm leading-relaxed">
          Official sets come from the{" "}
          <a
            className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
            href="https://library.ldraw.org/omr/sets"
            rel="noreferrer noopener"
            target="_blank"
          >
            LDraw Official Model Repository
          </a>
          , where every file is redistributable under CC BY 2.0 and credits the
          person who built it. Parts that cannot be found are skipped and
          flagged, and the rest of the model still builds.
        </p>
      </main>

      <LegalFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="readout tabular mt-1.5 text-ink text-sm">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-edge bg-panel p-6">
      <p className="text-ink text-sm">No packed models yet.</p>
      <p className="mt-2 max-w-xl text-muted text-sm leading-relaxed">
        The bundled models have not been packed for this deployment yet. The
        setup steps are in the project README. You can still drop your own
        self-contained .mpd file below without them.
      </p>
    </div>
  );
}
