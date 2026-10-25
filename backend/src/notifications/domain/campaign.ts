import { isAllowedDeepLink } from './deepLinks';
import type { EnqueueEventInput } from './types';

export type CampaignAudience = 'all_active' | 'promo_inbox' | 'promo_push_opt_in';
export type CampaignStatus = 'queued' | 'fanout' | 'completed' | 'cancelled';

export type NotificationCampaign = {
  id: string;
  name: string;
  title: string;
  body: string;
  deepLink: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  cursorUserId: string | null;
  fannedOut: number;
  occurredAt: string;
};

export type FanOutResult = { fannedOut: number; done: boolean; cursorUserId: string | null };

export const CAMPAIGN_AUDIENCES: readonly CampaignAudience[] = [
  'all_active',
  'promo_inbox',
  'promo_push_opt_in',
];

const TITLE_MAX = 120;
const BODY_MAX = 400;
const NAME_MAX = 120;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function campaignIdempotencyKey(campaignId: string, userId: string): string {
  return `campaign:${campaignId}:${userId}`;
}

/** Single-recipient shape; fan-out writes the same payload per user. */
export function promoBroadcastEvent(input: {
  campaignId: string;
  recipientUserId: string;
  occurredAt: string;
  title: string;
  body: string;
  deepLink: string;
}): EnqueueEventInput {
  return {
    eventType: 'promo.broadcast',
    idempotencyKey: campaignIdempotencyKey(input.campaignId, input.recipientUserId),
    recipientUserId: input.recipientUserId,
    actorUserId: null,
    occurredAt: input.occurredAt,
    payload: {
      campaignId: input.campaignId,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
    },
  };
}

export function parseCampaignDraft(body: Record<string, unknown>, occurredAt: string): {
  name: string;
  title: string;
  body: string;
  deepLink: string;
  audience: CampaignAudience;
  occurredAt: string;
} {
  const name = typeof body.name === 'string' ? clip(body.name, NAME_MAX) : '';
  const title = typeof body.title === 'string' ? clip(body.title, TITLE_MAX) : '';
  const text = typeof body.body === 'string' ? clip(body.body, BODY_MAX) : '';
  const deepLink = typeof body.deepLink === 'string' ? body.deepLink.trim() : '';
  const audience = body.audience;
  if (!name) throw new Error('name is required');
  if (!title) throw new Error('title is required');
  if (!text) throw new Error('body is required');
  if (!isAllowedDeepLink(deepLink)) throw new Error('deepLink is not allowlisted');
  if (typeof audience !== 'string' || !CAMPAIGN_AUDIENCES.includes(audience as CampaignAudience)) {
    throw new Error('audience must be all_active, promo_inbox, or promo_push_opt_in');
  }
  return { name, title, body: text, deepLink, audience: audience as CampaignAudience, occurredAt };
}
