/**
 * "Leaving Strafe" (the web's ExternalLinkModal), from the web's stores/externalLink: shown
 * for a link to a domain the person has not chosen to trust. "Always trust" adds the domain
 * to the same trusted list the web keeps; Visit opens the system browser.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { closeExternalLinkModal, confirmExternalLink, externalLink, getDomainFromUrl } from '@web/stores/externalLink';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Checkbox, Dialog, Text, withAlpha } from '@/ui';

export function ExternalLinkHost() {
  const theme = useTheme();
  const url = useSolid(() => externalLink.pendingUrl);
  const [trust, setTrust] = useState(false);
  const domain = url ? getDomainFromUrl(url) : '';
  useEffect(() => {
    if (url) setTrust(false);
  }, [url]);

  const close = () => {
    setTrust(false);
    closeExternalLinkModal();
  };

  return (
    <Dialog
      open={!!url}
      onClose={close}
      title={t('externalLink.title')}
      description={t('externalLink.body')}
      icon="triangle-exclamation"
      tone="warning"
      actions={[
        { label: t('common.cancel'), onPress: close, variant: 'outline' },
        { label: t('externalLink.visit'), onPress: () => confirmExternalLink(trust) },
      ]}
    >
      <View style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Text variant="overline">{t('externalLink.destination')}</Text>
          <View style={{ padding: 10, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.muted, 0.3) }}>
            <Text variant="mono" selectable numberOfLines={6} style={{ writingDirection: 'ltr' }}>
              {url ?? ''}
            </Text>
          </View>
        </View>
        {domain ? (
          <Checkbox
            checked={trust}
            onChange={setTrust}
            label={`${t('externalLink.alwaysTrust')} ${domain}`}
            description={t('externalLink.alwaysTrustDescription')}
          />
        ) : null}
      </View>
    </Dialog>
  );
}
