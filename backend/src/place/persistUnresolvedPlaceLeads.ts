import type { ExtractedPlaceMention } from './parseReasonerPayload';
import { placeNameIsSpecific } from './placeNameIsSpecific';
import { PlaceRepositoryError, type PlaceRepository } from './PlaceRepository';
import type { ContentSourcePlaceRecord } from './domain/types';

export type PersistUnresolvedPlaceLeadsResult = {
  kept: number;
  discarded: number;
  leads: number;
};

/**
 * Phase 2 persistence. Specific mentions become unresolved leads.
 * Generic place types are dropped. No canonical places row is created.
 */
export async function persistUnresolvedPlaceLeads(input: {
  repository: PlaceRepository;
  contentSourceId: string;
  imports: Array<{ id: string; userId: string }>;
  mentions: ExtractedPlaceMention[];
}): Promise<PersistUnresolvedPlaceLeadsResult> {
  let discarded = 0;
  const keptKeys: string[] = [];
  const hypotheses: ContentSourcePlaceRecord[] = [];
  for (const mention of input.mentions) {
    if (!placeNameIsSpecific(mention.name)) {
      discarded += 1;
      continue;
    }
    const hypothesis = await input.repository.upsertHypothesis({
      contentSourceId: input.contentSourceId,
      extractedName: mention.name,
      unresolvedReason: 'pending_resolution',
      category: mention.category,
      locality: mention.locality,
      city: mention.city,
      region: mention.region,
      country: mention.country,
      mentionedAddress: mention.mentionedAddress,
      confidence: mention.confidence,
      evidence: mention.evidence,
      sources: mention.sources,
    });
    keptKeys.push(hypothesis.hypothesisKey);
    hypotheses.push(hypothesis);
  }

  await input.repository.deleteUnresolvedExcept(input.contentSourceId, keptKeys);

  let leads = 0;
  for (const hypothesis of hypotheses) {
    for (const userImport of input.imports) {
      try {
        const save = await input.repository.insertLead({
          userId: userImport.userId,
          contentSourcePlaceId: hypothesis.id,
          contentSourceId: input.contentSourceId,
          userImportId: userImport.id,
        });
        if (!save.placeId) leads += 1;
      } catch (err) {
        if (err instanceof PlaceRepositoryError && err.code === 'duplicate') continue;
        throw err;
      }
    }
  }

  return { kept: hypotheses.length, discarded, leads };
}
