import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { MenuEspace } from '@/components/app/MenuEspace';
import { PressableScale, Text } from '@/components/ui';
import { espaceCourant, type IdEspace } from '@/lib/space-nav';
import { messagingApi } from '@/services/api/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

export function RolePersistentNav() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  const canMessage = permissions.includes('messages.read') || permissions.includes('*');
  const [menuOuvert, setMenuOuvert] = useState(false);

  const convQuery = useQuery({
    queryKey: queryKeys.messaging.conversations,
    queryFn: () => messagingApi.conversations({ limit: 50 }).then((r) => r.data),
    enabled: status === 'authenticated' && canMessage,
    refetchInterval: 8000,
  });

  if (status !== 'authenticated' || !user) return null;
  if (pathname.startsWith('/auth') || pathname.startsWith('/farmer')) return null;
  // Dans une discussion, la barre de saisie occupe le bas de l'écran (comme une messagerie).
  if (pathname.startsWith('/messages/')) return null;

  const has = (p: string) => permissions.includes(p) || permissions.includes("*");
  const homeRoute = has("admin.dashboard")
    ? "/admin"
    : has("cooperatives.write") || has("organizations.write")
      ? "/organization"
      : "/profil";

  // Espace du rôle (même partage que le Web : admin / organisation / espace membre).
  const espaceDuRole: IdEspace = homeRoute === '/admin' ? 'admin' : homeRoute === '/organization' ? 'organization' : 'app';
  const espace = espaceCourant(pathname, espaceDuRole);

  const unread = (convQuery.data as { totalUnread?: number } | undefined)?.totalUnread ?? 0;

  const items = [
    { key: 'home', label: 'Espace', icon: 'grid-outline' as const, route: homeRoute, active: pathname === homeRoute },
    ...(canMessage
      ? [{ key: 'messages', label: 'Messages', icon: 'chatbubbles-outline' as const, route: '/messages', active: pathname.startsWith('/messages'), badge: unread }]
      : []),
    { key: 'notifs', label: 'Alertes', icon: 'notifications-outline' as const, route: '/notifications', active: pathname.startsWith('/notifications'), badge: 0 },
    { key: 'profil', label: 'Profil', icon: 'person-outline' as const, route: '/profil', active: pathname.startsWith('/profil'), badge: 0 },
    // Menu = barre latérale Web de l'espace (toutes ses rubriques).
    { key: 'menu', label: 'Menu', icon: 'menu-outline' as const, route: '', active: menuOuvert, badge: 0 },
  ];

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom - 4, SPACING.xs) }]}>
      <View style={styles.bar}>
        {items.map((item) => (
          <PressableScale
            key={item.key}
            onPress={() => (item.key === 'menu' ? setMenuOuvert(true) : router.push(item.route as never))}
            style={[styles.tab, item.active ? styles.tabActive : null]}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={20} color={item.active ? COLORS.pureWhite : COLORS.slateGray} />
              {item.badge && item.badge > 0 ? (
                <View style={styles.badge}>
                  <Text preset="caption" color={COLORS.pureWhite} style={styles.badgeText}>
                    {item.badge > 99 ? '99+' : String(item.badge)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text preset="caption" color={item.active ? COLORS.pureWhite : COLORS.slateGray} style={styles.label}>
              {item.label}
            </Text>
          </PressableScale>
        ))}
      </View>
      <MenuEspace espace={espace} visible={menuOuvert} onFermer={() => setMenuOuvert(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: COLORS.naturalWhite, paddingHorizontal: 12, paddingTop: 4, borderTopWidth: 1, borderTopColor: COLORS.lightBorder },
  bar: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 560, backgroundColor: COLORS.pureWhite, borderRadius: RADIUS.pill, padding: 4, borderWidth: 1, borderColor: COLORS.lightBorder, gap: 4, ...Platform.select({ android: { elevation: 6 }, default: { boxShadow: '0 4px 16px rgba(12,30,21,0.1)' } }) },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: RADIUS.pill, gap: 2 },
  tabActive: { backgroundColor: COLORS.forestGreen },
  iconWrap: { position: 'relative' },
  badge: { position: 'absolute', top: -4, right: -10, backgroundColor: '#dc2626', borderRadius: 10, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: '700', lineHeight: 12 },
  label: { fontSize: 11, fontWeight: '600' },
});
