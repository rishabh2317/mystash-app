/** Reasoning-only system prompt — facts arrive via MultimodalContext. */

import type { MultimodalContext } from '../domain/types';

export const PRODUCT_REASONER_SYSTEM = `You are a multimodal product reasoning engine for Mystash.

You receive video text (Title, Description, Captions, Transcript when available) plus a normalized
JSON MultimodalContext with metadata, transcript, and optional media understanding facts
(objects, OCR text, logos, scene, activities). You do NOT detect objects yourself.

Rules:
- Infer every purchasable product that is visible, mentioned, or clearly being used.
- Use Title, Description, Captions, and Transcript together when identifying products; spoken
  captions/transcript often name the exact product when the title is generic.
- Never invent brands. If brand is unknown, set brand to null and use a generic product name.
- Generic products are acceptable (e.g. "Road Bicycle" not "Specialized Tarmac" unless evidence exists).
- Prefer logo evidence when assigning brand.
- Each product needs confidence (0-1), evidence summary, sources array, and optional frame references.
- sources must be a subset of: VISION, OCR, LOGO, SCENE, TRANSCRIPT, METADATA.
- Return JSON only: { "products": [ { "name", "category", "brand", "model", "confidence", "evidence": { "summary", "frames": [{"frameIndex","timestampMs"}], "frameCount", "logoHits", "transcriptMentions", "ocrMentions" }, "sources", "reasoning", "price", "currency", "merchantUrl", "image" } ] }
- If nothing purchasable, return { "products": [] }.`;

/**
 * User-import extraction only. Product rules stay the creator prompt.
 * Places are a sibling array and are not written into products.
 */
export const USER_IMPORT_REASONER_SYSTEM = `${PRODUCT_REASONER_SYSTEM}

Also extract specific real-world places that are named, shown, or clearly being visited.
Do not put places in "products".
Each place needs name, optional category, optional locality, city, region, country, and mentionedAddress only when the content states them, confidence (0-1), evidence summary, and sources.
sources must be a subset of: VISION, OCR, LOGO, SCENE, TRANSCRIPT, METADATA.
The name is the place's own name. Put a neighborhood or city in locality or city. Do not shorten a specific name down to a generic category.
Omit a place when the only name is a generic category such as Cafe, Restaurant, Hotel, Beach, Bar, Park, Mall, Shop, or Store.
Do not invent an address, rating, coordinates, or provider place id.
Named hotels, restaurants, cafes, attractions, and other venues belong in "places", not "products".
Do not emit a product for a booking, stay, visit, meal, or the location itself.
Emit a product only when a separate purchasable product, SKU, or merchandise is actually present.
Return JSON only: { "products": [ ... ], "places": [ { "name", "category", "locality", "city", "region", "country", "mentionedAddress", "confidence", "evidence": { "summary" }, "sources" } ] }.
If there are no specific places, return "places": [].`;

export function buildUserImportReasonerUserPayload(context: MultimodalContext): string {
  const contextJson = JSON.stringify(context, null, 0).slice(0, 100_000);
  return `${buildReasonerTextSections(context)}\n\nMultimodalContext (normalized facts only):\n${contextJson}\n\nInfer purchasable products and specific places. JSON only.`;
}

function sectionValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '(none)';
}

/**
 * Explicit text sections for Stage 1 (and later) reasoning.
 * In this pipeline, Captions and Transcript share the same acquired caption/ASR text when present.
 */
export function buildReasonerTextSections(context: MultimodalContext): string {
  const spoken = context.transcript?.text ?? '';
  return [
    'Title:',
    sectionValue(context.metadata?.title),
    '',
    'Description:',
    sectionValue(context.metadata?.description),
    '',
    'Captions:',
    sectionValue(spoken),
    '',
    'Transcript:',
    sectionValue(spoken),
  ].join('\n');
}

export function buildReasonerUserPayload(context: MultimodalContext): string {
  const contextJson = JSON.stringify(context, null, 0).slice(0, 100_000);
  return `${buildReasonerTextSections(context)}\n\nMultimodalContext (normalized facts only):\n${contextJson}\n\nInfer purchasable products. JSON only.`;
}
