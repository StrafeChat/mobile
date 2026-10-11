/**
 * Space settings -> Discover (SpaceDiscoverPage): apply to be listed on this instance's
 * Discover page. A mirrored space can only be listed by the instance that hosts it.
 */
import { t } from '@web/i18n/t';
import { applySpaceListing, getSpaceListing, withdrawSpaceListing } from '@web/api/discover';
import { DiscoverListingForm } from '../components/DiscoverListingForm';
import { SpacePage } from './SpacePage';

export function SpaceDiscoverScreen() {
  return (
    <SpacePage page="discover">
      {(data, { setError }) => (
        <DiscoverListingForm
          load={() => getSpaceListing(data.spaceId)}
          apply={(input) => applySpaceListing(data.spaceId, input)}
          withdraw={() => withdrawSpaceListing(data.spaceId)}
          blocked={data.space?.federation ? t('discover.listing.mirrored', { domain: data.space.federation.origin_domain }) : undefined}
          onError={setError}
        />
      )}
    </SpacePage>
  );
}
