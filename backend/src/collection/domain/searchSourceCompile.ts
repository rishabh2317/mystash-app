import type { Collection, CollectionProductTag, SearchSourceFields } from './types';
import { isPublishSurfaceTag } from './types';

export type SearchCompileInput = {
  title: string | null;
  caption: string | null;
  recommendationIntent: string | null;
  recommendationIntentsSecondary: string[];
  tags: Pick<
    CollectionProductTag,
    | 'brandSnapshot'
    | 'categorySnapshot'
    | 'nameSnapshot'
    | 'includeInPublish'
    | 'visibility'
    | 'tagStatus'
    | 'deletedAt'
  >[];
};

/** Compile canonical search source fields (not an index). */
export function compileSearchSourceFields(input: SearchCompileInput): SearchSourceFields {
  const included = input.tags.filter(isPublishSurfaceTag);
  const brands = unique(
    included.map((t) => t.brandSnapshot).filter((b): b is string => !!b && b.trim().length > 0),
  );
  const categories = unique(
    included
      .map((t) => t.categorySnapshot)
      .filter((c): c is string => !!c && c.trim().length > 0),
  );

  const intentKeywords = [
    input.recommendationIntent,
    ...input.recommendationIntentsSecondary,
  ].filter((x): x is string => !!x && x.trim().length > 0);

  const nameKeywords = included
    .map((t) => t.nameSnapshot)
    .filter((n): n is string => !!n && n.trim().length > 0)
    .slice(0, 12);

  const keywords = unique([...intentKeywords, ...nameKeywords, ...brands, ...categories]);

  const title = (input.title ?? '').trim() || null;
  const caption = (input.caption ?? '').trim();
  const searchTextParts = [title, caption, ...intentKeywords].filter(Boolean);

  return {
    searchTitle: title,
    searchText: searchTextParts.length ? searchTextParts.join('\n').slice(0, 8000) : null,
    searchKeywords: keywords,
    searchBrands: brands,
    searchCategories: unique([...categories, ...intentKeywords]),
    searchSourceUpdatedAt: new Date().toISOString(),
  };
}

export function compileFromCollection(
  collection: Pick<
    Collection,
    'title' | 'caption' | 'recommendationIntent' | 'recommendationIntentsSecondary'
  >,
  tags: CollectionProductTag[],
): SearchSourceFields {
  return compileSearchSourceFields({
    title: collection.title,
    caption: collection.caption,
    recommendationIntent: collection.recommendationIntent,
    recommendationIntentsSecondary: collection.recommendationIntentsSecondary,
    tags,
  });
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}
