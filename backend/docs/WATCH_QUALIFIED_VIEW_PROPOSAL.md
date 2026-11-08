# Proposed qualified Watch view (not implemented)

Collection `view` remains an open/active-index engagement event. It must not be reported as confirmed video playback.

For a future Watch metric, count one qualified view per user/session/reel when an embed confirms playback and at least 3 seconds of foreground, focused playback have elapsed. Pause the clock on tab blur, background, buffering, and swipe away. A replay counts separately only after the video reaches completion and the next playback again meets the threshold. Preserve anonymous session deduplication and consent checks. Never send private media URLs or raw watch history in analytics payloads. Define retention and creator-reporting eligibility before adding events or tables. Instagram and YouTube signal reliability, completion semantics, and cross-device deduplication require device validation before this contract is approved.
