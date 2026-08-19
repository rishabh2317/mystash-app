import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyYoutubePlayability,
  parseInnertubePlayerContext,
  parseStructuredDescriptionFromNext,
} from './youtubeContext';

describe('classifyYoutubePlayability', () => {
  it('does not block when public metadata exists', () => {
    assert.equal(classifyYoutubePlayability('UNPLAYABLE', true), undefined);
    assert.equal(classifyYoutubePlayability('LOGIN_REQUIRED', true), undefined);
  });

  it('classifies private/login as restricted without public metadata', () => {
    const r = classifyYoutubePlayability('LOGIN_REQUIRED', false);
    assert.equal(r?.availability, 'restricted');
    assert.equal(r?.code, 'SOURCE_RESTRICTED');
  });

  it('classifies unplayable as unavailable without public metadata', () => {
    const r = classifyYoutubePlayability('UNPLAYABLE', false);
    assert.equal(r?.availability, 'unavailable');
    assert.equal(r?.code, 'SOURCE_UNAVAILABLE');
  });

  it('does not block unknown/OK playability (empty captions still ingest)', () => {
    assert.equal(classifyYoutubePlayability('OK', false), undefined);
    assert.equal(classifyYoutubePlayability(null, false), undefined);
  });
});

describe('parseInnertubePlayerContext', () => {
  it('reads shortDescription and normalized metadata from videoDetails', () => {
    const parsed = parseInnertubePlayerContext({
      playabilityStatus: { status: 'UNPLAYABLE' },
      videoDetails: {
        title: 'iPhone 17 Pro Review',
        author: 'Tech Channel',
        shortDescription: '  Full iPhone 17 Pro description.  ',
        thumbnail: {
          thumbnails: [
            { url: 'https://img.example/small.jpg', width: 120 },
            { url: 'https://img.example/large.jpg', width: 1280 },
          ],
        },
      },
      microformat: {
        playerMicroformatRenderer: {
          description: { simpleText: 'Microformat fallback' },
        },
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: 'https://captions.example/track' }],
        },
      },
    });

    assert.equal(parsed.title, 'iPhone 17 Pro Review');
    assert.equal(parsed.authorName, 'Tech Channel');
    assert.equal(parsed.description, 'Full iPhone 17 Pro description.');
    assert.equal(parsed.descriptionSource, 'innertube_video_details');
    assert.equal(parsed.thumbnailUrl, 'https://img.example/large.jpg');
    assert.equal(parsed.captionTracks.length, 1);
    assert.equal(parsed.playabilityStatus, 'UNPLAYABLE');
  });

  it('falls back to microformat description and degrades to empty safely', () => {
    const fallback = parseInnertubePlayerContext({
      microformat: {
        playerMicroformatRenderer: {
          description: { runs: [{ text: 'iPhone ' }, { text: 'description' }] },
        },
      },
    });
    const empty = parseInnertubePlayerContext(null);

    assert.equal(fallback.description, 'iPhone description');
    assert.equal(fallback.descriptionSource, 'innertube_microformat');
    assert.equal(empty.description, '');
    assert.equal(empty.descriptionSource, 'none');
    assert.equal(empty.playabilityStatus, null);
  });
});

describe('parseStructuredDescriptionFromNext', () => {
  it('reads attributed description from structured engagement panel', () => {
    const parsed = parseStructuredDescriptionFromNext({
      engagementPanels: [
        {
          engagementPanelSectionListRenderer: {
            panelIdentifier: 'engagement-panel-structured-description',
            content: {
              structuredDescriptionContentRenderer: {
                items: [
                  {
                    expandableVideoDescriptionBodyRenderer: {
                      attributedDescriptionBodyText: {
                        content: 'Buy on Amazon https://example.com/p/1',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    });
    assert.equal(parsed.description, 'Buy on Amazon https://example.com/p/1');
    assert.equal(parsed.emptyConfirmed, false);
  });

  it('confirms explicitly empty creator descriptions', () => {
    const parsed = parseStructuredDescriptionFromNext({
      engagementPanels: [
        {
          engagementPanelSectionListRenderer: {
            panelIdentifier: 'engagement-panel-structured-description',
            content: {
              structuredDescriptionContentRenderer: {
                items: [
                  {
                    expandableVideoDescriptionBodyRenderer: {
                      descriptionPlaceholder: {
                        content: 'No description has been added to this video.',
                      },
                      colorSampledDescriptionBodyText: { content: '' },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    });
    assert.equal(parsed.description, '');
    assert.equal(parsed.emptyConfirmed, true);
  });
});
