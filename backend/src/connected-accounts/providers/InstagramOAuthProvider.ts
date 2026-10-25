import type { OAuthTokenBundle } from '../domain/types';
import type {
  ConnectedAccountOAuthProvider,
  HealthProbeResult,
  OAuthStartResult,
} from './types';

/**
 * Instagram adapter — VERIFY-gated stub until Meta checklist + flag are ready.
 * @see docs/creator-ecosystem-phase-2-verify.md
 */
export class InstagramOAuthProvider implements ConnectedAccountOAuthProvider {
  readonly provider = 'instagram' as const;

  buildAuthorizeUrl(_params: { state: string }): OAuthStartResult {
    throw new Error(
      'Instagram OAuth is not enabled. Complete VERIFY checklist and set CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED.',
    );
  }

  async exchangeCode(_params: { code: string }): Promise<OAuthTokenBundle> {
    throw new Error('Instagram OAuth is not enabled');
  }

  async healthCheck(_params: { accessToken: string }): Promise<HealthProbeResult> {
    return {
      ok: false,
      platformAccountId: '',
      displayName: null,
      username: null,
      error: 'Instagram health probe is not available until VERIFY completes',
    };
  }
}
