import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATE_COPY, CREATE_STACK_TITLES, draftResumeStatusLabel } from './createCopy';

describe('UX-CREATE-B.1 create copy', () => {
  it('uses Creator Studio stack titles', () => {
    assert.equal(CREATE_STACK_TITLES.studio, 'Creator Studio');
    assert.equal(CREATE_STACK_TITLES.manual, 'Add product links');
    assert.equal(CREATE_STACK_TITLES.editor, 'Edit Collection');
  });

  it('frames creation around Collections not extraction', () => {
    assert.match(CREATE_COPY.primaryStart, /Find products automatically/i);
    assert.doesNotMatch(CREATE_COPY.primaryStart, /extract/i);
    assert.match(CREATE_COPY.secondaryManual, /add products myself/i);
    assert.match(CREATE_COPY.studioSubhead, /Collection/i);
  });

  it('labels draft resume states for creators', () => {
    assert.equal(draftResumeStatusLabel('failed'), 'Needs attention');
    assert.equal(draftResumeStatusLabel('review_required'), 'Needs attention');
    assert.equal(draftResumeStatusLabel('processing'), 'Finding products');
    assert.equal(draftResumeStatusLabel('ready_for_review'), 'Ready to edit');
  });

  it('exposes segmented Studio draft section copy for B.4', () => {
    assert.equal(CREATE_COPY.continueSectionTitle, 'Continue creating');
    assert.equal(CREATE_COPY.processingSectionTitle, 'Processing');
    assert.equal(CREATE_COPY.attentionSectionTitle, 'Needs attention');
    assert.match(CREATE_COPY.draftsHubTitle, /Collections in progress/i);
  });

  it('exposes Collection Editor section and readiness copy for B.5', () => {
    assert.equal(CREATE_COPY.editorSectionContent, 'Content');
    assert.equal(CREATE_COPY.editorSectionProducts, 'Products');
    assert.equal(CREATE_COPY.editorSectionStory, 'Story');
    assert.equal(CREATE_COPY.editorSectionReadiness, 'Readiness');
    assert.match(CREATE_COPY.editorReadinessProductsTodo, /Include at least 1 product/i);
    assert.match(CREATE_COPY.editorStoryCaptionHint, /this device/i);
  });

  it('exposes inline/toast feedback copy for B.6', () => {
    assert.match(CREATE_COPY.refreshSuccessToast, /refreshed/i);
    assert.match(CREATE_COPY.publishFailedInline, /publish/i);
    assert.match(CREATE_COPY.urlExamplesHint, /youtube\.com\/shorts/i);
    assert.equal(CREATE_COPY.feedbackRetry, 'Retry');
  });

  it('exposes publish ritual copy for B.7', () => {
    assert.match(CREATE_COPY.publishConfirmTitle, /Publish Collection/i);
    assert.match(CREATE_COPY.publishConfirmPreview, /feed and on your profile/i);
    assert.equal(CREATE_COPY.publishSuccessTitle, 'Collection is live');
    assert.equal(CREATE_COPY.publishSuccessViewFeed, 'View in feed');
    assert.equal(CREATE_COPY.publishSuccessViewCollection, 'View Collection');
    assert.equal(CREATE_COPY.publishSuccessCreateAnother, 'Create another');
  });

  it('keeps Studio titles for B.8 design-system stack chrome', () => {
    assert.equal(CREATE_STACK_TITLES.studio, 'Creator Studio');
    assert.equal(CREATE_STACK_TITLES.editor, 'Edit Collection');
  });
});
