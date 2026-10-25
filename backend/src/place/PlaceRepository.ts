import type {
  ContentSourcePlaceRecord,
  InsertPlaceLeadRow,
  InsertPlaceRow,
  InsertUnresolvedHypothesisRow,
  PlaceRecord,
  UpgradePlaceLeadResult,
  UserPlaceSaveRecord,
} from './domain/types';
import type { PlaceSourceMedia } from './placeListImage';

export class PlaceRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate' | 'invalid' | 'not_found',
  ) {
    super(message);
    this.name = 'PlaceRepositoryError';
  }
}

export type PlaceRepository = {
  insertPlace(row: InsertPlaceRow): Promise<PlaceRecord>;
  findPlaceById(id: string): Promise<PlaceRecord | null>;
  findPlaceByProviderId(provider: string, providerPlaceId: string): Promise<PlaceRecord | null>;

  /** Unresolved hypothesis only. place_id stays null. Duplicate hypothesis key throws. */
  insertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord>;
  findHypothesis(
    contentSourceId: string,
    hypothesisKey: string,
  ): Promise<ContentSourcePlaceRecord | null>;
  findHypothesisById(id: string): Promise<ContentSourcePlaceRecord | null>;
  listHypotheses(contentSourceId: string): Promise<ContentSourcePlaceRecord[]>;
  /**
   * Reprocess path. Updates the extracted fields of an existing key.
   * A resolved row keeps its place id. A missing key is inserted unresolved.
   */
  upsertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord>;
  markHypothesisResolved(id: string, placeId: string): Promise<ContentSourcePlaceRecord>;

  /** Stash card. place_id is copied only when the hypothesis is already resolved. */
  insertLead(row: InsertPlaceLeadRow): Promise<UserPlaceSaveRecord>;
  findSaveByUserAndHypothesis(
    userId: string,
    contentSourcePlaceId: string,
  ): Promise<UserPlaceSaveRecord | null>;
  findSaveByUserAndPlace(userId: string, placeId: string): Promise<UserPlaceSaveRecord | null>;
  listSavesByUser(userId: string): Promise<UserPlaceSaveRecord[]>;
  /** Existing content-source thumbnail plus video thumbnail/frame if already stored. */
  findSourceMedia(contentSourceId: string): Promise<PlaceSourceMedia>;
  countByUserImport(userImportId: string): Promise<number>;
  upgradeLead(saveId: string, placeId: string): Promise<UpgradePlaceLeadResult>;
  /**
   * Drop unresolved hypotheses whose keys are absent after a reprocess.
   * Resolved rows stay. Saves that pointed at a removed hypothesis are removed.
   */
  deleteUnresolvedExcept(contentSourceId: string, keepKeys: string[]): Promise<number>;
};
