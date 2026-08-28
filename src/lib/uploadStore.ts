/**
 * Holds a dropped model in memory for the duration of a client-side navigation.
 *
 * Packed models run to several megabytes, which rules out sessionStorage, and
 * uploading them to a server we do not otherwise need would be worse. A module
 * map survives client-side routing but not a reload, so the builder page tells
 * the user to drop the file again rather than showing a blank canvas.
 */
export interface UploadedModel {
  /** Attribution for the model itself, shown in the viewer. See ModelData.credit. */
  credit?: string | null;
  /** Parts that could not be resolved and were left out of the build. */
  missingParts?: string[];
  partNames: Record<string, string>;
  slug: string;
  text: string;
  title: string;
}

const store = new Map<string, UploadedModel>();

export function putUpload(model: UploadedModel): string {
  store.set(model.slug, model);
  return model.slug;
}

export function takeUpload(slug: string): UploadedModel | null {
  return store.get(slug) ?? null;
}
