import type { CreatorStatus } from '../user/domain/types';
import type { Campaign } from './domain/types';

export function campaignIsOpen(campaign: Pick<Campaign, 'status' | 'startsAt' | 'endsAt'>, nowIso: string): boolean {
  if (campaign.status !== 'active') return false;
  if (campaign.startsAt && campaign.startsAt > nowIso) return false;
  if (campaign.endsAt && campaign.endsAt <= nowIso) return false;
  return true;
}

export function creatorCanSeeCampaign(input: {
  campaign: Pick<Campaign, 'status' | 'eligibility' | 'startsAt' | 'endsAt'>;
  creatorStatus: CreatorStatus;
  allowlisted: boolean;
  nowIso: string;
}): boolean {
  if (input.creatorStatus !== 'ACTIVE') return false;
  if (!campaignIsOpen(input.campaign, input.nowIso)) return false;
  if (input.campaign.eligibility === 'allowlist') return input.allowlisted;
  return true;
}
