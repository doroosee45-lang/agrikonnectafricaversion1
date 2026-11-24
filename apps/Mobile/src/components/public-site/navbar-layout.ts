type Insets = { top: number; bottom: number; left: number; right: number };
type Metrics = { navbarHeight: number; screenPadding: number; maxContentWidth: number };

export function getNavbarLayout(width: number, height: number, insets: Insets, metrics: Metrics, gap: number) {
  const barWidth = Math.max(0, Math.min(width - insets.left - insets.right - 2 * metrics.screenPadding, metrics.maxContentWidth));
  const barLeft = insets.left + (width - insets.left - insets.right - barWidth) / 2;
  const barTop = insets.top + gap;
  const contentTop = barTop + metrics.navbarHeight + gap;
  return {
    barWidth,
    barLeft,
    barTop,
    contentTop,
    panelMaxHeight: Math.max(0, height - insets.bottom - contentTop - gap),
  };
}
