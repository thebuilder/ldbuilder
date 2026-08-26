import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ModelMeta {
  blurb: string;
  bricks: number;
  bytes: number;
  credit: string;
  slug: string;
  steps: number;
  title: string;
  uniqueParts: number;
  userSupplied: boolean;
}

const MANIFEST_PATH = path.join(
  process.cwd(),
  "public",
  "models",
  "manifest.json"
);

/**
 * Read the packed-model manifest. Written by `pnpm ldraw:pack`; a checkout with
 * no manifest yet should render an empty gallery rather than crash.
 */
export async function getManifest(): Promise<ModelMeta[]> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as { models?: ModelMeta[] };
    return parsed.models ?? [];
  } catch {
    return [];
  }
}

export async function getModelMeta(slug: string): Promise<ModelMeta | null> {
  const models = await getManifest();
  return models.find((model) => model.slug === slug) ?? null;
}
