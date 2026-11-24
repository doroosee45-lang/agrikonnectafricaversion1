import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect, useState } from 'react';

import { IconButton, PressableScale, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { COLORS, TINTS } from '@/theme/colors';
import { DURATION, EASE } from '@/theme/motion';
import { LAYOUT, RADIUS, SPACING } from '@/theme/space';
import { useAuthStore } from '@/store/auth';
import { resolveActiveContext } from '@/lib/redirects';
import { canShowFarmerNavigation } from '@/lib/farmer-navigation';

/**
 * En-tête de l'espace producteur : identité, complétude du dossier et accès
 * rapides au profil et aux notifications.
 */
export function FarmerHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const completeness = useAuthStore((state) => state.completeness);
  const roles = resolveActiveContext(user).roles;
  const [menuVisible, setMenuVisible] = useState(false);
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming((completeness?.percent ?? 0) / 100, {
      duration: DURATION.reveal,
      easing: EASE.emphasize,
    });
  }, [completeness?.percent, progress]);

  const bar = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const navigationGroups = ([
    {
      title: t('ui.menuPrincipal'),
      items: [
        { label: t('ui.tableauDeBord'), route: '/farmer' },
        { label: t('ui.mesExploitations'), route: '/farmer/farms' },
        { label: t('ui.mesParcelles'), route: '/farmer/plots' },
        { label: t('ui.productionsDeclarees'), route: '/farmer/productions' },
        { label: t('ui.analysesDeSol'), route: '/farmer/soil' },
        { label: 'Messages', route: '/messages' },
      ],
    },
    {
      title: t('ui.commerceProjets'),
      items: [
      ],
    },
    {
      title: t('ui.capteursTerrain'),
      items: [
        { label: t('ui.galerieMedias'), route: '/farmer/gallery' },
      ],
    },
    {
      title: t('ui.compteConformite'),
      items: [
        { label: t('ui.monProfil'), route: '/farmer/profile' },
        { label: t('ui.fichePublique'), route: '/farmer/public-profile' },
        { label: t('ui.verificationKyc'), route: '/farmer/verification' },
        { label: t('ui.parametres_ef8f0'), route: '/farmer/settings' },
      ],
    },
  ] as const).map((group) => ({
    ...group,
    items: group.items.filter((item) => canShowFarmerNavigation(item.route, roles, permissions)),
  })).filter((group) => group.items.length > 0);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.row}>
          <PressableScale onPress={() => router.push('/farmer/profile')} style={styles.identity}>
            <View style={styles.avatar}>
              <Text preset="caption" color={COLORS.forestGreen}>
                {`${user?.firstName?.slice(0, 1) ?? ''}${user?.lastName?.slice(0, 1) ?? ''}`.toUpperCase()}
              </Text>
            </View>
            <View>
              <Text preset="caption" color={COLORS.slateGray}>
                {t('farmer.title')}
              </Text>
              <Text preset="bodyMedium" color={COLORS.textPrimary}>
                {user ? `${user.firstName} ${user.lastName}` : '—'}
              </Text>
            </View>
          </PressableScale>

          <View style={styles.actions}>
            <IconButton
              icon="menu-outline"
              onPress={() => setMenuVisible(true)}
              accessibilityLabel={t('ui.menuPrincipal')}
            />
            <IconButton icon="globe-outline" onPress={() => router.push('/accueil')} accessibilityLabel={t('ui.visiterLeSitePublic')} />
            <IconButton icon="notifications-outline" onPress={() => router.push('/notifications')} accessibilityLabel={t('nav.notifications')} />
            <IconButton icon="settings-outline" onPress={() => router.push('/farmer/settings')} accessibilityLabel={t('ui.parametres_ef8f0')} />
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text preset="h1" color={COLORS.textPrimary}>
            {title}
          </Text>
          {subtitle ? (
            <Text preset="bodySm" color={COLORS.slateGray} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {completeness ? (
          <PressableScale onPress={() => router.push('/farmer/profile')} style={styles.completeness}>
            <View style={styles.completenessRow}>
              <Ionicons name="checkmark-done-outline" size={14} color={COLORS.livingGreen} />
              <Text preset="caption" color={COLORS.slateGray}>{t('ui.dossierCompleteA', { percent: completeness.percent })}</Text>
              {completeness.missing.length > 0 ? (
                <Text preset="caption" color={COLORS.forestGreen}>{t('ui.restantS', { length: completeness.missing.length })}</Text>
              ) : null}
            </View>
            <View style={styles.track}>
              <Animated.View style={[styles.fill, bar]} />
            </View>
          </PressableScale>
        ) : null}
      </View>
      <Modal
        visible={menuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setMenuVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuVisible(false)} accessibilityLabel={t('common.close')} accessibilityRole="button" />
          <SafeAreaView edges={['top', 'bottom']} style={[styles.menuSheet, { width: Math.min(width * 0.86, 320) }]}>
            <View style={styles.menuHeader}>
              <Text preset="h2" color={COLORS.textPrimary}>{t('ui.monExploitation')}</Text>
              <IconButton
                icon="close-outline"
                onPress={() => setMenuVisible(false)}
                accessibilityLabel={t('ui.fermerLeDetail')}
              />
            </View>
            <ScrollView contentContainerStyle={styles.menuContent}>
              {navigationGroups.map((group) => (
                <View key={group.title} style={styles.menuGroup}>
                  <Text preset="overline" color={COLORS.slateGray}>{group.title}</Text>
                  {group.items.map((item) => (
                    <PressableScale
                      key={item.route}
                      onPress={() => {
                        setMenuVisible(false);
                        router.push(item.route);
                      }}
                      style={styles.menuItem}
                    >
                      <Text preset="bodyMedium" color={COLORS.textPrimary}>{item.label}</Text>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.slateGray} />
                    </PressableScale>
                  ))}
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.naturalWhite },
  header: {
    paddingHorizontal: LAYOUT.screenPadding,
    paddingBottom: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    backgroundColor: TINTS.livingGreenBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  titleBlock: { gap: 2 },
  subtitle: { lineHeight: 19 },
  completeness: { gap: SPACING.xs },
  completenessRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  track: { height: 6, borderRadius: RADIUS.pill, backgroundColor: TINTS.forestGreenBg, overflow: 'hidden' },
  fill: { height: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.livingGreen },
  modalBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.35)' },
  menuSheet: {
    height: '100%',
    backgroundColor: COLORS.naturalWhite,
    borderTopRightRadius: RADIUS.lg,
    borderBottomRightRadius: RADIUS.lg,
    paddingHorizontal: LAYOUT.screenPadding,
    paddingTop: SPACING.md,
  },
  menuHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: SPACING.sm },
  menuContent: { paddingBottom: SPACING.xl, gap: SPACING.lg },
  menuGroup: { gap: SPACING.xs },
  menuItem: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightBorder,
  },
});
