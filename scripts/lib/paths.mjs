import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
export const CACHE_DIR = path.join(ROOT, ".cache");
export const LIBRARY_DIR = path.join(ROOT, "ldraw-library");
export const PUBLIC_DIR = path.join(ROOT, "public");
export const PUBLIC_LDRAW_DIR = path.join(PUBLIC_DIR, "ldraw");
export const PUBLIC_MODELS_DIR = path.join(PUBLIC_DIR, "models");
export const PUBLIC_PARTS_DIR = path.join(PUBLIC_DIR, "parts");
export const SRC_DIR = path.join(ROOT, "src");
