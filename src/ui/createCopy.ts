/**
 * UX-CREATE-B.1 — Creator Studio copy contract.
 * User-facing Create strings only; routes/APIs unchanged.
 */

export const CREATE_STACK_TITLES = {
  studio: 'Creator Studio',
  manual: 'Add product links',
  editor: 'Edit Collection',
} as const;

export const CREATE_COPY = {
  /** Signed-out gate on Studio home */
  signInTitle: 'Sign in to Creator Studio',
  signInBody: 'Build shoppable Collections from your Reels and Shorts after you sign in on Profile.',

  /** Studio home (ACTIVE creator) */
  studioHeadline: 'Creator Studio',
  studioSubhead:
    'Build shoppable Collections from your Reels and Shorts. Add your video, curate products, then publish.',
  contentUrlLabel: 'Reel or Short URL',
  contentUrlPlaceholder: 'https://youtube.com/shorts/… or instagram.com/reel/…',
  collectionTitleLabel: 'Collection title (optional)',
  collectionTitlePlaceholder: 'Shown on your Collection and in the feed after publish',
  primaryStart: 'Find products automatically',
  secondaryManual: 'I\'ll add products myself',
  progressSending: 'Starting your Collection…',
  progressFindingProducts: 'Finding products from your video…',
  progressOpeningEditor: 'Opening Collection editor…',
  progressManualMode: 'Opening Collection editor…',

  /** Studio Home draft segments (UX-CREATE-B.4) */
  draftsHubTitle: 'Your Collections in progress',
  draftsHubSub: 'Unpublished Collections are saved automatically.',
  continueSectionTitle: 'Continue creating',
  continueSectionSub: 'Ready to keep editing.',
  processingSectionTitle: 'Processing',
  processingSectionSub: 'Finding products from your video.',
  attentionSectionTitle: 'Needs attention',
  attentionSectionSub: 'Something needs a fix before you can publish.',
  continueEmpty: 'No Collections in progress yet.',
  continueAction: 'Resume',
  processingAction: 'Open',
  attentionAction: 'Fix',

  /** Manual product links screen */
  manualHeadline: 'Add product links',
  manualSubhead:
    'Start a Collection with your Reel or Short, then add up to five shop links. We skip automatic product discovery from the video.',
  manualFetch: 'Add products to Collection',
  manualPreview: 'Products added',
  manualContinue: 'Edit Collection',

  /** Collection editor (review screen) */
  editorLoading: 'Loading Collection…',
  editorMissingId: 'This Collection could not be opened.',
  editorBackToStudio: 'Back to Creator Studio',
  editorNotFound: 'Collection not found. Start a new one from Creator Studio.',
  editorSignInPublish: 'Sign in to publish your Collection.',
  editorContentLabel: 'Content',
  editorFailedTitle: 'Could not load video',
  editorFailedBody: 'We could not process this Reel or Short. Nothing was published.',
  editorRetryFind: 'Find products again',
  editorAddLinks: 'Add product links',
  editorProcessing: 'Finding products from your video…',
  editorProcessingHint: 'You can leave and come back — this Collection is saved.',
  editorRefresh: 'Refresh',
  editorExtractionNotice: 'Heads up',
  editorNoProductsTitle: 'No products found yet',
  editorNoProductsBody:
    'We could not find shoppable products in this video. Add product links to continue building your Collection.',
  editorAddLinksAction: 'Add product links',
  editorNoteManual:
    'Add shop links for this Collection, then choose what to publish.',
  editorNoteOk:
    'Tap a product for details. Toggle In Collection to choose what publishes.',
  editorNotePreview:
    'Products start unchecked when discovery was uncertain. Include only what you want to publish.',
  editorDiscard: 'Discard Collection',
  editorDiscardConfirmTitle: 'Discard Collection?',
  editorDiscardConfirmBody: 'This unpublished Collection will be deleted.',
  editorPublish: 'Publish Collection',
  editorPublishSelect: 'Select products',
  editorPublishSelectBody: 'Include at least one product in your Collection before publishing.',
  editorPublishResolving: 'Products still loading',
  editorPublishResolvingBody:
    'Wait until every included product finishes loading before you publish.',
  editorPublishSuccessTitle: 'Collection published',
  editorPublishSuccessBody: 'Your Collection is live in the feed.',

  /** Publish ritual (UX-CREATE-B.7) */
  publishConfirmTitle: 'Publish Collection?',
  publishConfirmPreview:
    'Your Collection will appear in the feed and on your profile.',
  publishConfirmPrimary: 'Publish Collection',
  publishConfirmSecondary: 'Keep editing',
  publishPublishing: 'Publishing your Collection…',
  publishSuccessTitle: 'Collection is live',
  publishSuccessBody: 'Shoppers can find it in the feed and on your profile.',
  publishSuccessViewFeed: 'View in feed',
  publishSuccessViewCollection: 'View Collection',
  publishSuccessCreateAnother: 'Create another',

  editorResolvingHint: 'Checking product details…',
  editorIncludeLabel: 'In Collection',

  /** Collection Editor sections (UX-CREATE-B.5) */
  editorSectionContent: 'Content',
  editorSectionProducts: 'Products',
  editorSectionStory: 'Story',
  editorSectionStoryOptional: 'Optional',
  editorSectionReadiness: 'Readiness',
  editorStoryTitleLabel: 'Title',
  editorStoryTitlePlaceholder: 'Collection title',
  editorStoryCaptionLabel: 'Caption',
  editorStoryCaptionPlaceholder: 'Add a short caption (optional)',
  editorStoryCaptionHint: 'Caption stays on this device until a later publish update.',
  editorReadinessContentDone: 'Content attached',
  editorReadinessContentTodo: 'Add a Reel or Short',
  editorReadinessProductsDone: 'At least 1 product included',
  editorReadinessProductsTodo: 'Include at least 1 product',
  editorReadinessResolvingDone: 'Products ready to publish',
  editorReadinessResolvingTodo: 'product(s) still need attention',
  editorReadinessExpandHint: 'Finish the checklist to publish.',

  /** Feedback (UX-CREATE-B.6) — inline / toast; Alert only for discard */
  feedbackRetry: 'Retry',
  feedbackDismiss: 'Dismiss',
  creatorActivatedToast: 'You can now build and publish Collections.',
  creatorActivatedManualToast: 'You can now build Collections with product links.',
  refreshSuccessToast: 'Product details refreshed.',
  refreshFailedInline: 'Could not refresh product details.',
  refreshNotFoundInline: 'This Collection was not found.',
  retryFailedInline: 'Could not restart product discovery.',
  publishFailedInline: 'Could not publish this Collection.',
  storyTitleSaveFailed: 'Could not save title. Try again.',
  partialLinksTitle: 'Some links could not be read',
  partialLinksBody: 'Could not extract:',
  manualSaveFailedInline: 'Could not save product links.',
  manualAddSuccessToast: 'Products added to Collection.',
  urlExamplesHint: 'Example: youtube.com/shorts/… or instagram.com/reel/…',

  /** Shared copy (inline / toast; Alert only for discard) */
  creatorActivatedTitle: 'You are a creator',
  creatorActivatedBody: 'You can now build and publish Collections.',
  creatorActivatedManualBody: 'You can now build Collections with product links.',
  unsupportedUrlTitle: 'Unsupported link',
  unsupportedUrlBody:
    'Paste a YouTube Short or Instagram Reel URL. Profile pages and other sites are not supported.',
  startFailedTitle: 'Could not start Collection',
  startFailedBody: 'Something went wrong. Try again.',
  creatorRequiredTitle: 'Creator account required',
  creatorRequiredBody: 'Become an ACTIVE creator before publishing Collections.',
  creatorRequiredSetupBody:
    'Finish creator setup on Creator Studio, then try again.',
} as const;

export type DraftResumeStatus =
  | 'draft'
  | 'processing'
  | 'ready_for_review'
  | 'review_required'
  | 'failed';

/** User-facing badge for an unpublished Collection on Studio home. */
export function draftResumeStatusLabel(status: DraftResumeStatus | string): string {
  if (status === 'failed') return 'Needs attention';
  if (status === 'review_required') return 'Needs attention';
  if (status === 'processing') return 'Finding products';
  if (status === 'draft' || status === 'ready_for_review') return 'Ready to edit';
  return 'In progress';
}
