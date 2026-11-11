import { normalizeProductHttpUrl } from './createStudioFlow';
import { CREATE_COPY } from './createCopy';

export const MAX_STUDIO_PRODUCT_LINKS = 5;
export type StudioProductLinkField = { id: number; value: string };

/** Match the existing API's URL normalization, retaining affiliate query parameters. */
export function collectStudioProductLinks(fields: StudioProductLinkField[]) {
  const urls: string[] = [], seen = new Set<string>();
  const errors: Record<number, string> = {}, duplicates: number[] = [];
  for (const field of fields) {
    if (!field.value.trim()) continue;
    const url = normalizeProductHttpUrl(field.value);
    if (!url) { errors[field.id] = CREATE_COPY.productLinkInvalid; continue; }
    if (seen.has(url)) { duplicates.push(field.id); continue; }
    seen.add(url); urls.push(url);
  }
  return { urls, errors, duplicates, valid: urls.length > 0 && fields.length <= MAX_STUDIO_PRODUCT_LINKS && Object.keys(errors).length === 0 };
}
