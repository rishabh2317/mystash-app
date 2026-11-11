import type { MultimodalContext, ProductCandidate, ProductEvidence } from '../domain/types';
import type { ExtractedPlaceMention } from '../place/parseReasonerPayload';

export const FIND_EVIDENCE_VERSION = 'find-video-evidence-v1';
const garment = /\b(jacket|shirt|jeans|trousers|dress|coat|hoodie|sweater|skirt)\b/i;
const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function evidenceOf(p: ProductCandidate): ProductEvidence {
  const value = p.evidence && typeof p.evidence === 'object' ? p.evidence : null;
  return { ...value, summary: typeof p.evidence === 'string' ? p.evidence : typeof value?.summary === 'string' ? value.summary : '',
    frames: Array.isArray(value?.frames) ? value.frames.filter(f => f && Number.isInteger(f.frameIndex) && Number.isFinite(f.timestampMs)) : [],
    frameCount: Number.isFinite(value?.frameCount) ? value!.frameCount : 0,
    logoHits: Array.isArray(value?.logoHits) ? value.logoHits.filter(v => typeof v === 'string') : [],
    transcriptMentions: !!value?.transcriptMentions, ocrMentions: !!value?.ocrMentions,
    attributes: Array.isArray(value?.attributes) ? value.attributes.filter(v => v && typeof v.attribute === 'string' && typeof v.value === 'string') : [] };
}

/** Find-only evidence adapter. No image, merchant or catalogue fields are changed. */
export function prepareFindHypotheses(products: ProductCandidate[], ctx: MultimodalContext, stage: string): ProductCandidate[] {
  return products.filter(product => product && typeof product.name === 'string').flatMap(product => {
    let p = { ...product, brand: typeof product.brand === 'string' ? product.brand : null,
      model: typeof product.model === 'string' ? product.model : null,
      sources: Array.isArray(product.sources) ? product.sources.filter(s => typeof s === 'string') : [] };
    const ev = evidenceOf(p);
    const visualOnly = p.sources.every(s => s === 'VISION' || s === 'SCENE');
    const sourceText = [ctx.metadata.title, ctx.metadata.description, ctx.transcript.text].filter(Boolean).join('\n');
    const model = p.model?.replace(/^(?:id|sku|model)\s*[:#]?\s+(?=[a-z0-9-]*\d)/i, '');
    if (model && model !== p.model && plain(sourceText).includes(plain(model))) p.model = model;
    const anchor = p.model || p.brand;
    const associatedText = anchor ? sourceText.split('\n').filter(line =>
      (` ${plain(line)} `).includes(` ${plain(anchor)} `)).join('\n') : sourceText;
    const supported = (ctx.media?.objects ?? []).filter(o => o.confidence >= 0.6 && !/^(person|man|woman|people|boy|girl)$/i.test(o.label) &&
      (ev.frames?.some(f => f.frameIndex === o.frameIndex) || (visualOnly && (ctx.media?.objects.length ?? 0) === 1)));
    const visibleTypes = new Set(supported.map(o => o.label.match(garment)?.[1]?.toLowerCase()).filter(Boolean));
    const requestedType = p.name.match(garment)?.[1]?.toLowerCase();
    const textSupportsType = requestedType && new RegExp(`\\b${requestedType}\\b`, 'i').test(sourceText);
    if (!ctx.media && requestedType && !textSupportsType && !p.model) return [];
    const conflict = !textSupportsType && requestedType && visibleTypes.size > 0 && !visibleTypes.has(requestedType);
    if (conflict) {
      // Use the linked type when unambiguous; otherwise retain a generic lead.
      // Neither correction establishes a brand/model.
      p = { ...p, name: visibleTypes.size === 1 ? supported.find(o => garment.test(o.label))!.label : 'Clothing (type unconfirmed)', brand: null, model: null };
    }
    const attributes: NonNullable<ProductEvidence['attributes']> = [];
    for (const claim of ev.attributes ?? []) {
      if (claim.origin === 'source_text' && ['colour','material','fit','style','type'].includes(claim.attribute)
        && typeof claim.value === 'string' && claim.value.length <= 100 && plain(claim.value)
        && (` ${plain(associatedText)} `).includes(` ${plain(claim.value)} `)) {
        attributes.push({ attribute: claim.attribute, value: claim.value, origin: 'source_text' });
      }
    }
    for (const object of supported) {
      attributes.push({ attribute: 'type', value: object.label, origin: 'observed', frameIndex: object.frameIndex, timestampMs: object.timestampMs });
      for (const key of ['colour','material','fit','style','brandText','visibleIdentifier'] as const) {
        const value = object.attributes?.[key];
        if (value) attributes.push({ attribute: key, value, origin: 'observed', frameIndex: object.frameIndex, timestampMs: object.timestampMs });
      }
    }
    for (const key of ['brand','model'] as const) {
      const value = p[key];
      if (value && plain(sourceText).includes(plain(value))) attributes.push({ attribute: key, value, origin: 'source_text' });
    }
    // Scene/visual resemblance alone never establishes a branded exact product.
    if (visualOnly) p = { ...p, brand: null, model: null };
    const possible = Boolean(conflict) || visualOnly || (garment.test(p.name) && !p.model);
    return [{ ...p, evidence: { ...ev, attributes, uncertainty: [...new Set(supported.flatMap(o => o.attributes?.uncertainty ?? []))], stages: [stage],
      ...(conflict ? { rejectedHypotheses: [{ reason: 'visual_type_conflict', stage }] } : {}),
      ...(possible ? { identification: { version: 1 as const, kind: 'possible' as const, reason: visualOnly ? 'visual_identity_unconfirmed' : 'exact_style_unconfirmed' } } : {}) } }];
  });
}

/** Keep separate model/variant hypotheses; merge only the same identity. */
export function retainFindHypotheses(previous: ProductCandidate[], current: ProductCandidate[]): ProductCandidate[] {
  const key = (p: ProductCandidate) => plain([p.name, p.brand, p.model].filter(Boolean).join('|'));
  const retained = new Map(previous.map(p => [key(p), p]));
  for (const p of current) {
    const old = retained.get(key(p));
    if (!old) { retained.set(key(p), p); continue; }
    const a = evidenceOf(old), b = evidenceOf(p);
    const unique = <T>(values: T[]) => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
    const frames = unique([...a.frames, ...b.frames]);
    retained.set(key(p), { ...p, sources: [...new Set([...old.sources, ...p.sources])], evidence: { ...a, ...b,
      frames, frameCount: frames.length, attributes: unique([...(a.attributes ?? []), ...(b.attributes ?? [])]),
      uncertainty: [...new Set([...(a.uncertainty ?? []), ...(b.uncertainty ?? [])])],
      stages: [...new Set([...(a.stages ?? []), ...(b.stages ?? [])])] } });
  }
  return [...retained.values()];
}

/** Copy a locality only from a same-line explicit "Venue, Location" span. */
export function groundPlaceLocality(places: ExtractedPlaceMention[], text: string): ExtractedPlaceMention[] {
  return places.map(place => {
    if (place.locality || place.city || place.mentionedAddress) return place;
    for (const line of text.split('\n')) {
      const index = line.toLowerCase().indexOf(place.name.toLowerCase());
      if (index < 0) continue;
      const match = line.slice(index + place.name.length).match(/^\s*(?:,|[–—-]|\bin\b)\s*([\p{L}][\p{L} .'-]{1,60}?)(?=,|[;.!#\n]|$)/u);
      const locality = match?.[1]?.trim();
      if (!locality || /\b(and|or|near|above|below|hotel|resort|https?)\b/i.test(locality)) continue;
      return { ...place, locality, evidence: { ...place.evidence, localityProvenance: { origin: 'source_text', value: locality } } };
    }
    return place;
  });
}
