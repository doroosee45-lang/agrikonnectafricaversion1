import { Platform, type TextStyle } from 'react-native';

const regular = Platform.select({ ios: 'System', default: 'sans-serif' });
const medium = Platform.select({ ios: 'System', default: 'sans-serif-medium' });
const semibold = Platform.select({ ios: 'System', default: 'sans-serif' });
const bold = Platform.select({ ios: 'System', default: 'sans-serif' });
const mono = Platform.select({ ios: 'Courier New', default: 'monospace' });

export const FONT = {
  display: { medium, semibold, bold },
  body: { regular, medium, semibold, bold },
  mono: { regular: mono, medium: mono },
} as const;

export function useAppFonts() {
  return true;
}

type Preset = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontWeight?: TextStyle['fontWeight'];
  textTransform?: TextStyle['textTransform'];
};

const PRESETS = {
  heroDisplay: { fontFamily: FONT.display.bold, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, fontWeight: '700' },
  display: { fontFamily: FONT.display.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, fontWeight: '700' },
  h1: { fontFamily: FONT.display.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, fontWeight: '600' },
  h2: { fontFamily: FONT.display.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.2, fontWeight: '600' },
  h3: { fontFamily: FONT.display.medium, fontSize: 20, lineHeight: 26, fontWeight: '500' },
  lead: { fontFamily: FONT.body.regular, fontSize: 16, lineHeight: 25 },
  body: { fontFamily: FONT.body.regular, fontSize: 15, lineHeight: 23 },
  bodyMedium: { fontFamily: FONT.body.medium, fontSize: 15, lineHeight: 23, fontWeight: '500' },
  bodySm: { fontFamily: FONT.body.regular, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: FONT.body.medium, fontSize: 12, lineHeight: 17, fontWeight: '500' },
  overline: {
    fontFamily: FONT.body.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  button: { fontFamily: FONT.body.semibold, fontSize: 15, lineHeight: 20, letterSpacing: 0.1, fontWeight: '600' },
  numeric: { fontFamily: FONT.display.semibold, fontSize: 28, lineHeight: 32, letterSpacing: -0.5, fontWeight: '600' },
  technique: { fontFamily: FONT.mono.regular, fontSize: 13, lineHeight: 18 },
} satisfies Record<string, Preset>;

export type TypePreset = keyof typeof PRESETS;

export function type(preset: TypePreset, override?: TextStyle): TextStyle {
  return { ...PRESETS[preset], ...override };
}

export const TYPO = PRESETS;
