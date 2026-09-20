import type {
  ContentSourceRecord,
  RequestProcessingResult,
  ResolveContentSourceResult,
} from '../content-source/domain/types';

/**
 * Content Source dependency of User Import.
 *
 * User Import depends on this port, not on ContentSourceService internals: submissions stay
 * user-scoped while global content identity and the queue handoff stay in Content Source.
 */
export type UserImportContentSourcePort = {
  getOrCreate(normalizedUrl: string): Promise<ResolveContentSourceResult>;
  getById(id: string): Promise<ContentSourceRecord | null>;
  requestProcessing(params: {
    contentSource: ContentSourceRecord;
    userImportId: string;
  }): Promise<RequestProcessingResult>;
};

/** Applied after submit when the global source already has bound products. */
export type UserImportBagSyncPort = {
  applyIfResolved(row: {
    id: string;
    userId: string;
    contentSourceId: string | null;
  }): Promise<void>;
};
