import { Suspense } from 'react'
import type { Metadata } from 'next'
import { BuilderClient } from '@/components/viewer/BuilderClient'
import { getManifest, getModelMeta } from '@/lib/manifest'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  const models = await getManifest()
  return models.map((model) => ({ slug: model.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const meta = await getModelMeta(slug)
  if (!meta) return { title: 'Model' }
  return {
    title: meta.title,
    description: `${meta.bricks} bricks across ${meta.steps} build steps. ${meta.blurb}`.trim(),
  }
}

export default async function BuildPage({ params }: PageProps) {
  const { slug } = await params
  // A missing manifest entry is not an error: dropped files use a `local-`
  // slug that only ever exists in the browser.
  const meta = await getModelMeta(slug)
  return (
    // nuqs reads the query string, so the client half has to be able to bail
    // out of prerendering. The fallback is the same graphite ground the canvas
    // paints, so there is nothing to see flash.
    <Suspense fallback={<div className="h-dvh w-full bg-ground" />}>
      <BuilderClient slug={slug} meta={meta} />
    </Suspense>
  )
}
