/**
 * "Learn more" about bridges: the instance's own docs (what a bridge copies, how a person opts
 * out), in the in-app browser - the web's BRIDGES_LEARN_MORE, on this instance's web origin.
 */
import { BRIDGES_LEARN_MORE } from '@web/lib/bridgePlatforms';
import { openExternalUrl } from '@/platform/overrides/desktop/native';

export function bridgesLearnMoreUrl(): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return `${origin}${BRIDGES_LEARN_MORE}`;
}

export function openBridgesLearnMore(): void {
  void openExternalUrl(bridgesLearnMoreUrl());
}
