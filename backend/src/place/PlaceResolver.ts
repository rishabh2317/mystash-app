import { logger } from '../logger';
import { decidePlaceMention } from './decidePlaceMention';
import { placeHypothesisKey } from './domain/hypothesisKey';
import type { InsertUnresolvedHypothesisRow, PlaceRecord, PlaceUnresolvedReason } from './domain/types';
import type { ExtractedPlaceMention } from './parseReasonerPayload';
import type { PlaceSearchCandidate } from './placeIdentityMatch';
import { placeNameIsSpecific } from './placeNameIsSpecific';
import { PlaceRepositoryError, type PlaceRepository } from './PlaceRepository';
import {
  DEFAULT_PLACE_SEARCH_TIMEOUT_MS,
  searchPlacesWithTimeout,
  type PlaceSearchProvider,
} from './PlaceSearchProvider';

export type PlaceResolutionSummary = {
  kept: number;
  discarded: number;
  leads: number;
  resolved: number;
};

/**
 * Runs the identity gate for one content source and writes the outcome.
 * A canonical places row is inserted only for a resolved decision.
 */
export class PlaceResolver {
  constructor(
    private readonly repository: PlaceRepository,
    private readonly search: PlaceSearchProvider,
    private readonly timeoutMs = DEFAULT_PLACE_SEARCH_TIMEOUT_MS,
  ) {}

  async resolveMentions(input: {
    contentSourceId: string;
    imports: Array<{ id: string; userId: string }>;
    mentions: ExtractedPlaceMention[];
  }): Promise<PlaceResolutionSummary> {
    const summary: PlaceResolutionSummary = { kept: 0, discarded: 0, leads: 0, resolved: 0 };
    const keptKeys: string[] = [];

    for (const mention of input.mentions) {
      try {
        const outcome = await this.resolveMention(input.contentSourceId, input.imports, mention);
        if (outcome.discarded) {
          summary.discarded += 1;
          continue;
        }
        summary.kept += 1;
        keptKeys.push(outcome.hypothesisKey);
        summary.leads += outcome.leads;
        if (outcome.resolved) summary.resolved += 1;
      } catch (err) {
        logger.warn(
          { err, contentSourceId: input.contentSourceId },
          'place.resolution.failed',
        );
        if (!placeNameIsSpecific(mention.name)) {
          summary.discarded += 1;
          continue;
        }
        const saved = await this.saveUnresolved(input.contentSourceId, input.imports, mention, 'provider_failed');
        summary.kept += 1;
        keptKeys.push(saved.hypothesisKey);
        summary.leads += saved.leads;
      }
    }

    await this.repository.deleteUnresolvedExcept(input.contentSourceId, keptKeys);
    return summary;
  }

  private async resolveMention(
    contentSourceId: string,
    imports: Array<{ id: string; userId: string }>,
    mention: ExtractedPlaceMention,
  ): Promise<{ discarded: boolean; hypothesisKey: string; leads: number; resolved: boolean }> {
    const fields = hypothesisFields(contentSourceId, mention, 'pending_resolution');
    const existing = await this.repository.findHypothesis(contentSourceId, placeHypothesisKey({
      extractedName: mention.name,
      locality: mention.locality,
      city: mention.city,
      region: mention.region,
      country: mention.country,
      mentionedAddress: mention.mentionedAddress,
    }));
    if (existing?.resolutionState === 'resolved' && existing.placeId) {
      const hypothesis = await this.repository.upsertHypothesis(fields);
      const attached = await this.attachImports(imports, hypothesis.id, contentSourceId, hypothesis.placeId);
      logger.info(
        { contentSourceId, placeId: hypothesis.placeId },
        'place.match.accepted',
      );
      return { discarded: false, hypothesisKey: hypothesis.hypothesisKey, leads: attached.leads, resolved: true };
    }

    let candidates: PlaceSearchCandidate[] = [];
    const started = Date.now();
    const decision = await decidePlaceMention(mention, async (query) => {
      logger.info({ contentSourceId, query }, 'place.search.started');
      const attempt = await searchPlacesWithTimeout(this.search, query, this.timeoutMs);
      logger.info(
        {
          contentSourceId,
          durationMs: Date.now() - started,
          candidateCount: attempt.ok ? attempt.candidates.length : 0,
          ok: attempt.ok,
        },
        'place.search.completed',
      );
      if (attempt.ok) candidates = attempt.candidates;
      return attempt;
    });

    if (decision.outcome === 'discarded') {
      logger.info({ contentSourceId, reason: decision.reason }, 'place.discarded');
      return { discarded: true, hypothesisKey: '', leads: 0, resolved: false };
    }

    if (decision.outcome === 'unresolved') {
      if (!decision.searched) {
        logger.info({ contentSourceId, reason: decision.reason }, 'place.search.skipped');
      } else if (decision.reason === 'provider_failed') {
        logger.warn({ contentSourceId, reason: decision.reason }, 'place.resolution.failed');
      } else {
        logger.info(
          { contentSourceId, reason: decision.reason },
          decision.reason === 'ambiguous' ? 'place.match.ambiguous' : 'place.match.rejected',
        );
      }
      const saved = await this.saveUnresolved(contentSourceId, imports, mention, decision.reason);
      return { discarded: false, hypothesisKey: saved.hypothesisKey, leads: saved.leads, resolved: false };
    }

    const candidate = candidates.find((row) => row.providerPlaceId === decision.providerPlaceId) ?? null;
    if (!candidate) {
      const saved = await this.saveUnresolved(contentSourceId, imports, mention, 'provider_failed');
      return { discarded: false, hypothesisKey: saved.hypothesisKey, leads: saved.leads, resolved: false };
    }

    const place = await this.findOrInsertPlace(candidate);
    const hypothesis = await this.repository.upsertHypothesis(fields);
    const resolved = await this.repository.markHypothesisResolved(hypothesis.id, place.id);
    const attached = await this.attachImports(imports, resolved.id, contentSourceId, place.id);
    logger.info(
      { contentSourceId, providerPlaceId: place.providerPlaceId, placeId: place.id },
      'place.match.accepted',
    );
    return { discarded: false, hypothesisKey: resolved.hypothesisKey, leads: attached.leads, resolved: true };
  }

  private async saveUnresolved(
    contentSourceId: string,
    imports: Array<{ id: string; userId: string }>,
    mention: ExtractedPlaceMention,
    reason: PlaceUnresolvedReason,
  ): Promise<{ hypothesisKey: string; leads: number }> {
    const hypothesis = await this.repository.upsertHypothesis(
      hypothesisFields(contentSourceId, mention, reason),
    );
    const attached = await this.attachImports(imports, hypothesis.id, contentSourceId, null);
    if (attached.leads > 0) {
      logger.info(
        { contentSourceId, contentSourcePlaceId: hypothesis.id, reason },
        'place.lead.saved',
      );
    }
    return { hypothesisKey: hypothesis.hypothesisKey, leads: attached.leads };
  }

  private async findOrInsertPlace(candidate: PlaceSearchCandidate): Promise<PlaceRecord> {
    const existing = await this.repository.findPlaceByProviderId(this.search.name, candidate.providerPlaceId);
    if (existing) return existing;
    try {
      return await this.repository.insertPlace({
        provider: this.search.name,
        providerPlaceId: candidate.providerPlaceId,
        name: candidate.name,
        locality: candidate.locality,
        city: candidate.city,
        region: candidate.region,
        country: candidate.country,
        category: candidate.category,
        formattedAddress: candidate.formattedAddress,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        mapsUrl: candidate.mapsUrl,
      });
    } catch (err) {
      if (err instanceof PlaceRepositoryError && err.code === 'duplicate') {
        const again = await this.repository.findPlaceByProviderId(this.search.name, candidate.providerPlaceId);
        if (again) return again;
      }
      throw err;
    }
  }

  private async attachImports(
    imports: Array<{ id: string; userId: string }>,
    contentSourcePlaceId: string,
    contentSourceId: string,
    placeId: string | null,
  ): Promise<{ leads: number }> {
    let leads = 0;
    for (const userImport of imports) {
      const existing = await this.repository.findSaveByUserAndHypothesis(userImport.userId, contentSourcePlaceId);
      if (placeId) {
        if (existing?.placeId === placeId) continue;
        if (existing) {
          const upgraded = await this.repository.upgradeLead(existing.id, placeId);
          logger.info(
            {
              contentSourceId,
              userId: userImport.userId,
              placeId,
              merged: upgraded.merged,
            },
            upgraded.merged ? 'place.lead.upgraded' : 'place.attached',
          );
          continue;
        }
        try {
          await this.repository.insertLead({
            userId: userImport.userId,
            contentSourcePlaceId,
            contentSourceId,
            userImportId: userImport.id,
          });
          logger.info({ contentSourceId, userId: userImport.userId, placeId }, 'place.attached');
        } catch (err) {
          if (err instanceof PlaceRepositoryError && err.code === 'duplicate') {
            logger.info(
              { contentSourceId, userId: userImport.userId, placeId, merged: true },
              'place.lead.upgraded',
            );
            continue;
          }
          throw err;
        }
        continue;
      }

      if (existing) continue;
      try {
        const save = await this.repository.insertLead({
          userId: userImport.userId,
          contentSourcePlaceId,
          contentSourceId,
          userImportId: userImport.id,
        });
        if (!save.placeId) leads += 1;
      } catch (err) {
        if (err instanceof PlaceRepositoryError && err.code === 'duplicate') continue;
        throw err;
      }
    }
    return { leads };
  }
}

function hypothesisFields(
  contentSourceId: string,
  mention: ExtractedPlaceMention,
  unresolvedReason: PlaceUnresolvedReason,
): InsertUnresolvedHypothesisRow {
  return {
    contentSourceId,
    extractedName: mention.name,
    unresolvedReason,
    category: mention.category,
    locality: mention.locality,
    city: mention.city,
    region: mention.region,
    country: mention.country,
    mentionedAddress: mention.mentionedAddress,
    confidence: mention.confidence,
    evidence: mention.evidence,
    sources: mention.sources,
  };
}
