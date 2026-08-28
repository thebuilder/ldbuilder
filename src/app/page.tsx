import Link from "next/link";
import { DropZone } from "@/components/DropZone";
import { FreeBuildCard } from "@/components/free/FreeBuildCard";
import { HeroBuild } from "@/components/HeroBuild";
import { OpenSetCard } from "@/components/OpenSetCard";
import { ResumeBadge } from "@/components/ResumeBadge";
import { LegalFooter } from "@/components/shell/LegalFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getManifest, type ModelMeta } from "@/lib/manifest";

export default async function GalleryPage() {
  const models = await getManifest();
  const hero = pickHeroModel(models);

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        The header is the model: the canvas sits behind the type, building the
        set the gallery below is full of. It is the claim and the demonstration
        in the same rectangle, which is why the text over it can be two lines.
      */}
      <header className="relative overflow-hidden border-edge border-b">
        {hero ? (
          <HeroBuild slug={hero.slug} title={hero.title} url={hero.url} />
        ) : null}

        <div className="relative mx-auto max-w-6xl px-6 py-10 lg:py-14">
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

          {/* Held clear of the right-hand third so the model has somewhere to
              stand, and so the drag that turns it lands on the canvas. */}
          <div className="mt-16 mb-52 max-w-2xl lg:mt-28 lg:mb-28">
            {/* Broken by hand rather than left to wrap: the two halves are a
                promise and its answer, and the second is a shade back so the
                first is what the eye lands on. */}
            <p className="font-semibold text-4xl text-ink leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
              Watch it build itself.
              <span className="block text-muted">Then build it yourself.</span>
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <section aria-labelledby="start-heading">
          <h2 className="label mb-5" id="start-heading">
            Start a build
          </h2>

          {/* Search first and largest: it reaches every official set, where
              everything below it reaches one. Free build sits beside it because
              it is the same decision made the other way. */}
          <div className="grid gap-px lg:grid-cols-5">
            <OpenSetCard className="lg:col-span-3" featured />
            <FreeBuildCard className="lg:col-span-2" />
          </div>
          <DropZone className="mt-px" />

          <p className="mt-4 max-w-3xl text-muted text-sm leading-relaxed">
            Official sets come from the{" "}
            <a
              className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
              href="https://library.ldraw.org/omr/sets"
              rel="noreferrer noopener"
              target="_blank"
            >
              LDraw Official Model Repository
            </a>
            , where every file is redistributable under CC BY 2.0 and credits
            the person who built it. Parts that cannot be found are skipped and
            flagged, and the rest of the model still builds.
          </p>
        </section>

        <section aria-labelledby="models-heading" className="mt-14">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="label" id="models-heading">
              Models
            </h2>
            <span className="readout text-faint">
              {models.length} available
            </span>
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
          </ul>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}

/**
 * Above this a hero would cost more to load than the page it decorates.
 *
 * It is also the loader's smoothing threshold, so the model behind the header
 * is one whose studs are round.
 */
const HERO_MAX_BRICKS = 200;

/**
 * Which bundled model builds itself behind the header.
 *
 * The car by name, because it is the canonical LDraw demo and it reads as a
 * thing rather than as a shape; otherwise the largest model this deployment
 * packed that is still cheap enough to put on a page nobody has committed to.
 * A checkout with nothing packed gets a header with no model in it.
 */
function pickHeroModel(
  models: ModelMeta[]
): { slug: string; title: string; url: string } | null {
  const affordable = models.filter(
    (model) => model.bricks <= HERO_MAX_BRICKS && model.bricks > 0
  );
  const chosen =
    affordable.find((model) => model.slug === "car") ??
    affordable.reduce<ModelMeta | null>(
      (best, model) => (best && best.bricks >= model.bricks ? best : model),
      null
    );

  return chosen
    ? {
        slug: chosen.slug,
        title: chosen.title,
        url: `/models/${chosen.slug}.mpd`,
      }
    : null;
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
        self-contained .mpd file above without them.
      </p>
    </div>
  );
}
