/**
 * UX-CREATE-B.1 — Creator Studio copy contract.
 * User-facing Create strings only; routes/APIs unchanged.
 */

export const CREATE_STACK_TITLES = {
  studio: 'Creator Studio',
  manual: 'Products only',
  editor: 'Edit Collection',
} as const;

export const CREATE_COPY = {
  /** Signed-out gate on Studio home */
  signInTitle: 'Sign in to Creator Studio',
  signInBody: 'Build shoppable Collections from your Reels and Shorts after you sign in on Profile.',

  /** Studio home (ACTIVE creator) — default / shared */
  studioHeadline: 'Creator Studio',
  studioSubhead:
    'Build shoppable Collections from your Reels and Shorts. Add your video, curate products, then publish.',
  /** Single-page studio journey (01 Video → 02 Products → 03 Publish) */
  studioJourneySubhead: 'Choose a video, add products, then publish.',
  stepVideo: 'Video',
  stepProducts: 'Products',
  stepPublish: 'Publish',
  continueToProducts: 'Continue to Products',
  continueToPublish: 'Continue to Publish',
  chooseYourVideo: 'Choose your video',
  videoStageSub: 'Choose the video you want to turn into a shoppable Collection.',
  productsStageSub: 'Add products to your Collection',
  publishStageSub: 'Review and publish your Collection',
  productsNotStarted: 'Not started',
  pasteUrlAlt: 'Or paste a URL',
  studioDraftsTitle: 'My Drafts',
  collectionPreviewLabel: 'Collection preview',
  videoSelectedBadge: 'Selected',
  changeVideo: 'Change',
  usePastedUrl: 'Use this URL',
  pasteUrlTitle: 'Paste Reel or Short URL',
  addVideoFrom: 'Add video from',
  addVideoOr: 'or',
  libraryStepTitle: 'Synced videos',
  libraryStepSub: 'Pick a Short or Reel you already synced. Playback stays on the platform.',
  productsLockedHint: 'Choose a video first to unlock products.',
  publishLockedHint: 'Add at least one product to unlock publish.',
  productSourcesHint: 'Add one or more products. You can mix sources.',
  productSourceAiTitle: 'Find products with AI',
  productSourceAiBody: 'Extract products automatically from the selected video.',
  productSourceLinkTitle: 'Add product / affiliate link',
  productSourceLinkBody: 'Paste a product or affiliate URL. We extract details with AI.',
  productSourceLinkPlaceholder: 'https://…',
  productSourceLinkAction: 'Add product',
  productSourceInventoryTitle: 'Mystash inventory',
  productSourceInventoryBody: 'Select products from available brand and marketplace campaigns.',
  productSourceInventorySoon: 'Coming soon',
  productSourceAi: 'AI from video',
  productSourceLink: 'Product link',
  studioDescriptionLabel: 'Description / hashtags (optional)',
  studioDescriptionPlaceholder: 'A short note or hashtags for this Collection',
  discardCollection: 'Discard',
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

  /** Phase 1 mode entry (CreateMode) — does not change review/publish copy */
  modeChooserHint: 'What are you creating?',
  modeMyContentHeadline: 'My content',
  modeMyContentSubhead:
    'Paste a Reel or Short you created, curate products, then publish a shoppable Collection.',
  modeMyContentUrlLabel: 'Your Reel or Short URL',
  modeCurateHeadline: 'Curate public content',
  modeCurateSubhead:
    'Paste a public YouTube Short or Instagram Reel URL to curate into a Mystash Collection.',
  modeCurateUrlLabel: 'Public Reel or Short URL',
  modeProductsHeadline: 'Products only',
  modeProductsSubhead:
    'Start with shop links and a source video. We skip automatic product discovery from the video.',
  modeProductsCta: 'Add product links',
  connectAccountsTitle: 'Connect Instagram / YouTube',
  connectAccountsBody:
    'Account linking is coming soon. For now, paste a Reel or Short URL from your content.',
  connectAccountsBadge: 'Coming soon',
  connectAccountsManage: 'Manage in Settings',
  connectAccountsConnected: 'Connected',
  connectAccountsNeedsReauth: 'Needs re-auth',
  connectAccountsConnectAction: 'Connect',
  connectAccountsPasteHint: 'You can always paste a Reel or Short URL below.',
  libraryTitle: 'Your YouTube library',
  librarySync: 'Sync',
  librarySyncing: 'Syncing…',
  libraryEmpty: 'Nothing synced yet. Sync pulls titles and links only — playback stays on YouTube.',
  libraryUnavailable: 'Unavailable',
  libraryProducts: 'Products',
  libraryProductHint: 'Attach an existing catalog or discovered product. This does not publish a Collection.',
  libraryCampaignProducts: 'Campaign products',
  libraryProductPlaceholder: 'Product id',
  libraryAttachCatalog: 'Attach catalog',
  libraryAttachDiscovered: 'Attach discovered',
  libraryRemoveProduct: 'Remove',
  libraryAddCollection: 'Add to Collection',
  libraryNewCollection: 'New Collection',
  libraryPublish: 'Publish',

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

  /** Manual / Products only screen */
  manualHeadline: 'Products only',
  manualSubhead:
    'Add a source Reel or Short, then up to five shop links. We skip automatic product discovery from the video.',
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
  editorPasteProductLink: 'Paste product link',
  editorAddFromLibrary: 'Add from synced library',
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
  publishConfirmReady: 'Ready to publish',
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

  /** Become-a-creator gate (Create tab, not Settings onboarding) */
  onboardingEyebrow: 'Creator Studio',
  onboardingEyebrowSetup: 'Creator onboarding',
  onboardingHeadline: 'Become a Mystash creator',
  onboardingHeadlineSetup: 'Activate your creator account',
  onboardingBody:
    'Collections can only be created by ACTIVE creators. Become a creator to open Creator Studio. This uses your existing Mystash account — no separate creator signup.',
  onboardingBodySetup:
    'You started creator setup. Finish activation to unlock Creator Studio and publish Collections. This uses your existing Mystash account — no separate signup.',
  onboardingBodyOther:
    'Collections can only be created by ACTIVE creators. This uses your existing Mystash account — no separate creator signup.',
  onboardingDisplayName: 'Display name (optional)',
  onboardingDisplayNamePlaceholder: 'Shown on your public profile',
  onboardingCta: 'Become a creator',
  onboardingCtaFinish: 'Finish creator setup',
  onboardingRefresh: 'Refresh status',
  onboardingLoading: 'Checking creator status…',
  onboardingLoadErrorTitle: 'Could not load account',
  onboardingLoadErrorBody: 'Something went wrong loading your account.',
  onboardingTryAgain: 'Try again',
  onboardingSuspendedTitle: 'Creator suspended',
  onboardingSuspendedBody:
    'Your creator privileges are suspended. You can still browse, but you cannot create Collections until reinstated.',

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

/** Prefill optional display name without repeating the @username. */
export function createOnboardingDisplayName(input: {
  displayName: string | null | undefined;
  username: string | null | undefined;
  fullName: string | null | undefined;
}): string | null {
  const handle = input.username?.trim().replace(/^@/, '').toLowerCase() ?? '';
  for (const raw of [input.displayName, input.fullName]) {
    const name = raw?.trim();
    if (!name) continue;
    if (handle && name.replace(/^@/, '').toLowerCase() === handle) continue;
    return name;
  }
  return input.displayName?.trim() || null;
}

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
