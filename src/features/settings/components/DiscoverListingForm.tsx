/**
 * A Discover listing, from the applicant's side (DiscoverListingForm): where it stands (not
 * listed, waiting, listed, declined with the administrators' note), the tagline and tags for
 * the card, sharing with federated instances, and apply / save / withdraw. Shared by a space's
 * settings and an application's bot; the caller supplies the API calls.
 *
 * Tags are typed as on the web (comma-separated, at most five); the parsed tags show as chips
 * under the field so the split is visible while typing.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatDate, t } from '@web/i18n/t';
import { DISCOVER_TAGLINE_MAX, DISCOVER_TAGS_MAX, parseTags, type DiscoverListing, type ListingInput } from '@web/api/discover';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useTheme } from '@/theme';
import { Button, Checkbox, Icon, Input, ListSection, Spinner, Text, withAlpha } from '@/ui';
import { FormCard, Note, SettingItem } from './rows';

export interface DiscoverListingFormProps {
  load: () => Promise<DiscoverListing | null>;
  apply: (input: ListingInput) => Promise<DiscoverListing>;
  withdraw: () => Promise<void>;
  /** When set, listing is not possible and this explains why. */
  blocked?: string;
  onError?: (msg: string) => void;
}

type Status = DiscoverListing['status'] | 'none';

export function listingStatusKey(l: DiscoverListing | null): string {
  if (!l) return 'discover.listing.statusNone';
  return l.status === 'approved' ? 'discover.listing.statusApproved' : l.status === 'pending' ? 'discover.listing.statusPending' : 'discover.listing.statusDenied';
}

export function listingSubmitKey(l: DiscoverListing | null): string {
  if (!l) return 'discover.listing.apply';
  return l.status === 'denied' ? 'discover.listing.reapply' : 'discover.listing.update';
}

const when = (iso?: string) => (iso ? formatDate(iso, { dateStyle: 'medium' }) || iso : '');

export function DiscoverListingForm({ load, apply, withdraw, blocked, onError }: DiscoverListingFormProps) {
  const theme = useTheme();
  const [listing, setListing] = useState<DiscoverListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [tagline, setTagline] = useState('');
  const [tags, setTags] = useState('');
  const [federate, setFederate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function seed(l: DiscoverListing | null) {
    setListing(l);
    setTagline(l?.tagline ?? '');
    setTags((l?.tags ?? []).join(', '));
    setFederate(l?.federate ?? true);
  }

  useEffect(() => {
    let live = true;
    load()
      .then((l) => live && seed(l))
      .catch((e) => live && onError?.(translateCaughtApiError(e, t).join(' ') || t('discover.listing.loadFailed')))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = parseTags(tags);
  const tooMany = parsed.length > DISCOVER_TAGS_MAX;
  const status: Status = listing?.status ?? 'none';
  const statusColor =
    status === 'approved' ? theme.colors.success : status === 'pending' ? theme.colors.warning : status === 'denied' ? theme.colors.destructive : theme.colors.mutedForeground;
  const statusIcon = status === 'approved' ? 'circle-check' : status === 'pending' ? 'hourglass-half' : status === 'denied' ? 'circle-xmark' : 'circle';

  async function submit() {
    if (tooMany || busy) return;
    setBusy(true);
    setError('');
    try {
      seed(await apply({ tagline: tagline.trim(), tags: parsed, federate }));
    } catch (err) {
      setError(translateCaughtApiError(err, t).join(' ') || t('discover.listing.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!listing) return;
    const label = listing.status === 'approved' ? t('discover.listing.withdraw') : t('discover.listing.withdrawPending');
    const ok = await confirmDialog({ title: label, body: t('discover.listing.withdrawConfirm'), confirmLabel: label, tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await withdraw();
      seed(null);
    } catch (err) {
      setError(translateCaughtApiError(err, t).join(' ') || t('discover.listing.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Note>{t('discover.listing.intro')}</Note>
      {loading ? (
        <Spinner fill />
      ) : blocked ? (
        <FormCard>
          <Text tone="muted">{blocked}</Text>
        </FormCard>
      ) : (
        <>
          <ListSection>
            <SettingItem
              leading={<Icon name={statusIcon} size={18} color={statusColor} />}
              title={t(listingStatusKey(listing))}
              description={
                listing
                  ? `${t('discover.listing.requestedAt', { date: when(listing.requested_at) })}${listing.reviewed_at ? ` · ${t('discover.listing.reviewedAt', { date: when(listing.reviewed_at) })}` : ''}`
                  : undefined
              }
              testID="discover-status"
            />
            {listing?.status === 'denied' && listing.note ? (
              <View style={{ marginHorizontal: 16, marginBottom: 14, padding: 12, borderRadius: theme.radii.md, backgroundColor: withAlpha(theme.colors.destructive, 0.08), gap: 4 }}>
                <Text variant="caption" weight="semibold">
                  {t('discover.listing.note')}
                </Text>
                <Text selectable>{listing.note}</Text>
              </View>
            ) : null}
          </ListSection>
          <FormCard>
            <Input
              label={t('discover.listing.tagline')}
              value={tagline}
              maxLength={DISCOVER_TAGLINE_MAX}
              placeholder={t('discover.listing.taglinePlaceholder')}
              onChangeText={setTagline}
              hint={`${t('discover.listing.taglineHint')} ${tagline.length}/${DISCOVER_TAGLINE_MAX}`}
              disabled={busy}
              testID="discover-tagline"
            />
            <View style={{ gap: 8 }}>
              <Input
                label={t('discover.listing.tags')}
                value={tags}
                placeholder={t('discover.listing.tagsPlaceholder')}
                onChangeText={setTags}
                autoCapitalize="none"
                error={tooMany ? t('discover.listing.tooManyTags', { count: DISCOVER_TAGS_MAX }) : undefined}
                hint={t('discover.listing.tagsHint')}
                disabled={busy}
                testID="discover-tags"
              />
              {parsed.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {parsed.map((tag, i) => (
                    <View
                      key={`${tag}-${i}`}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: i < DISCOVER_TAGS_MAX ? withAlpha(theme.colors.primary, 0.15) : withAlpha(theme.colors.destructive, 0.15),
                      }}
                    >
                      <Text variant="caption" tone={i < DISCOVER_TAGS_MAX ? 'default' : 'danger'}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <Checkbox checked={federate} disabled={busy} onChange={setFederate} label={t('discover.listing.federate')} description={t('discover.listing.federateHint')} />
            {error ? (
              <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button title={t(listingSubmitKey(listing))} loading={busy} disabled={tooMany} onPress={() => void submit()} testID="discover-submit" />
              {listing ? (
                <Button
                  title={listing.status === 'approved' ? t('discover.listing.withdraw') : t('discover.listing.withdrawPending')}
                  variant="outline"
                  disabled={busy}
                  onPress={() => void remove()}
                />
              ) : null}
            </View>
          </FormCard>
        </>
      )}
    </View>
  );
}
