import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { SUPPORTED_LOCALES, useI18n } from '@/i18n';
import { COLORS, DARK } from '@/theme/colors';
import { DURATION, EASE } from '@/theme/motion';
import { LAYOUT, RADIUS, SPACING } from '@/theme/space';
import { useAuthStore } from '@/store/auth';
import { getUserInitialRoute } from '@/lib/redirects';

import { Button, PressableScale, Text } from '@/components/ui';

import { Logo } from './Logo';
import { getNavbarLayout } from './navbar-layout';

export interface NavItem {
  key: string;
  href: string;
  labelKey: 'nav.home' | 'nav.services' | 'nav.markets' | 'nav.projects' | 'nav.farmers' | 'nav.about' | 'nav.tenders' | 'nav.news' | 'nav.contact' | 'ui.donnees';
}

export const PUBLIC_NAV: NavItem[] = [
  { key: 'accueil', href: '/accueil', labelKey: 'nav.home' },
  { key: 'a-propos', href: '/a-propos', labelKey: 'nav.about' },
  { key: 'services', href: '/services', labelKey: 'nav.services' },
  { key: 'marches', href: '/marches', labelKey: 'nav.markets' },
  { key: 'farmers', href: '/farmers', labelKey: 'nav.farmers' },
  { key: 'projets', href: '/projets', labelKey: 'nav.projects' },
  { key: 'data', href: '/public-site/data', labelKey: 'ui.donnees' },
  { key: 'actualites', href: '/actualites', labelKey: 'nav.news' },
  { key: 'contact', href: '/contact', labelKey: 'nav.contact' },
  { key: 'tenders', href: '/tenders', labelKey: 'nav.tenders' },
];

/**
 * Barre et panneau de navigation propres au site public.
 */
export function Navbar({
  items = PUBLIC_NAV,
}: {
  items?: NavItem[];
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const isCompact = width < 1280;
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  useEffect(() => setMenuOpen(false), [pathname, isCompact]);

  useEffect(() => {
    if (!menuOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMenuOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [menuOpen]);

  const { barWidth, barLeft, barTop, contentTop, panelMaxHeight } = getNavbarLayout(width, height, insets, LAYOUT, SPACING.sm);

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={[styles.bar, { top: barTop, left: barLeft, width: barWidth }]}>
        <View style={styles.inner}>
          <View>
            <PressableScale onPress={() => router.push('/accueil')} accessibilityRole="link">
              <Logo size={40} showTagline />
            </PressableScale>
          </View>

          {!isCompact ? (
            <View style={styles.links}>
              {items.map((item) => (
                <NavLink
                  key={item.key}
                  label={t(item.labelKey)}
                  active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  onPress={() => router.push(item.href as never)}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            {!isCompact ? <LanguageToggle locale={locale} onChange={setLocale} /> : null}

            {!isCompact ? (
              isAuthenticated ? (
                <Button
                  label={t('ui.retourAMonEspace')}
                  onPress={() => {
                    const etat = useAuthStore.getState();
                    router.push(getUserInitialRoute({ user: etat.user, permissions: etat.permissions }).route);
                  }}
                  variant="primary"
                  size="sm"
                  icon="leaf"
                />
              ) : (
                <>
                  <Button label={t('nav.login')} onPress={() => router.push('/auth/login')} variant="ghost" size="sm" />
                  <Button label={t('nav.signup')} onPress={() => router.push('/auth/register')} variant="primary" size="sm" />
                </>
              )
            ) : (
              <PressableScale
                onPress={() => setMenuOpen((open) => !open)}
                style={styles.menuToggle}
                accessibilityRole="button"
                accessibilityLabel={menuOpen ? t('common.close') : t('nav.menu')}
                accessibilityState={{ expanded: menuOpen }}
              >
                <Ionicons name={menuOpen ? 'close' : 'menu'} size={26} color={COLORS.pureWhite} />
              </PressableScale>
            )}
          </View>
        </View>
      </View>

      {menuOpen && isCompact ? (
        <View pointerEvents="box-none" style={[styles.panelPosition, { top: contentTop, left: barLeft, width: barWidth }]}>
          <MobileMenu
            items={items}
            onClose={() => setMenuOpen(false)}
            isAuthenticated={isAuthenticated}
            locale={locale}
            onLocaleChange={setLocale}
            maxHeight={panelMaxHeight}
          />
        </View>
      ) : null}
    </View>
  );
}

function NavLink({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const hover = useSharedValue(0);

  const underline = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(active ? 1 : 0, hover.value) }],
    opacity: active ? 1 : hover.value,
  }));

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="link"
      style={styles.link}
      onHoverIn={() => {
        hover.value = withTiming(1, { duration: DURATION.instant, easing: EASE.out });
      }}
      onHoverOut={() => {
        hover.value = withTiming(0, { duration: DURATION.instant, easing: EASE.out });
      }}
    >
      <Text preset="caption" color={active ? COLORS.forestGreen : COLORS.slateGray}>
        {label}
      </Text>
      <Animated.View style={[styles.underline, underline]} />
    </PressableScale>
  );
}

function LanguageToggle({
  locale,
  onChange,
}: {
  locale: 'fr' | 'en';
  onChange: (next: 'fr' | 'en') => void;
}) {
  return (
    <View style={styles.lang}>
      {SUPPORTED_LOCALES.map((item) => {
        const active = item.code === locale;
        return (
          <PressableScale
            key={item.code}
            onPress={() => onChange(item.code)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.langItem, active ? styles.langItemActive : null]}
          >
            <Text preset="overline" color={active ? COLORS.pureWhite : COLORS.slateGray} style={{ fontSize: 10 }}>
              {item.code.toUpperCase()}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function MobileMenu({
  items,
  onClose,
  isAuthenticated,
  locale,
  onLocaleChange,
  maxHeight,
}: {
  items: NavItem[];
  onClose: () => void;
  isAuthenticated: boolean;
  locale: 'fr' | 'en';
  onLocaleChange: (next: 'fr' | 'en') => void;
  maxHeight: number;
}) {
  const { t } = useI18n();
  const pathname = usePathname();

  const go = (href: string) => {
    onClose();
    router.push(href as never);
  };

  return (
    <Animated.View entering={FadeIn.duration(DURATION.fast)} style={[styles.sheet, { maxHeight }]}>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetLinks}>
          {items.map((item) => (
            <PressableScale key={item.key} onPress={() => go(item.href)} style={styles.sheetLink} accessibilityRole="link" accessibilityState={{ selected: pathname === item.href }}>
              <Text preset="bodyMedium" color={COLORS.forestGreen} style={styles.sheetLinkText}>
                {t(item.labelKey)}
              </Text>
            </PressableScale>
          ))}
          {isAuthenticated ? (
            <PressableScale
              style={styles.sheetLink}
              accessibilityRole="link"
              onPress={() => {
                const etat = useAuthStore.getState();
                go(getUserInitialRoute({ user: etat.user, permissions: etat.permissions }).route);
              }}
            >
              <Text preset="bodyMedium" color={COLORS.forestGreen} style={styles.sheetLinkText}>{t('ui.retourAMonEspace')}</Text>
            </PressableScale>
          ) : (
            <>
              <PressableScale style={styles.sheetLink} accessibilityRole="link" onPress={() => go('/auth/login')}>
                <Text preset="bodyMedium" color={COLORS.forestGreen} style={styles.sheetLinkText}>{t('nav.login')}</Text>
              </PressableScale>
              <PressableScale style={styles.sheetLink} accessibilityRole="link" onPress={() => go('/auth/register')}>
                <Text preset="bodyMedium" color={COLORS.forestGreen} style={styles.sheetLinkText}>{t('nav.signup')}</Text>
              </PressableScale>
            </>
          )}
          <LanguageToggle locale={locale} onChange={onLocaleChange} />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 20 },
  bar: {
    position: 'absolute',
    height: LAYOUT.navbarHeight,
    zIndex: 1,
    borderWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.lightBorder,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.pureWhite,
    shadowColor: 'rgba(23, 77, 53, 0.12)',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    shadowOpacity: 0.08,
    elevation: 1,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    height: '100%',
    paddingHorizontal: SPACING.md,
    width: '100%',
  },
  links: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  link: { paddingVertical: SPACING.sm, alignItems: 'center', gap: 4 },
  underline: {
    height: 2,
    width: '100%',
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.livingGreen,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  menuToggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.pill, backgroundColor: COLORS.forestGreen },
  lang: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.lightBorder,
    borderRadius: RADIUS.pill,
    padding: 2,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  langItem: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.pill },
  langItemActive: { backgroundColor: COLORS.forestGreen },
  panelPosition: { position: 'absolute' },
  sheet: {
    backgroundColor: COLORS.pureWhite,
    borderRadius: 28,
    overflow: 'hidden',
  },
  sheetLinks: { paddingHorizontal: 32, paddingVertical: SPACING.xl, alignItems: 'flex-start' },
  sheetLink: {
    alignSelf: 'stretch',
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 58,
  },
  sheetLinkText: { fontSize: 18, lineHeight: 26 },
});

export const NAVBAR_HEIGHT = LAYOUT.navbarHeight;
export const MOBILE_MENU_EXIT = FadeOut;
export const NAV_DARK_TEXT = DARK.text;
