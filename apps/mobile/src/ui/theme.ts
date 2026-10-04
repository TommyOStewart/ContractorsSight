// Rugged & bold: charcoal ground, safety-orange accent, warm off-white text.
// Text on orange is always dark (`onAccent`); white on orange fails contrast.
export const colors = {
  background: '#16181B',
  surface: '#22262B',
  surfaceSunk: '#1B1E22',
  border: '#2F343A',
  borderStrong: '#3A3F46',
  divider: '#2C3036',

  text: '#F4F1EA',
  textSoft: '#C9C2B4',
  muted: '#A9ADB3',

  accent: '#FF7A1A',
  onAccent: '#16181B',
  accentWash: '#2A2016',
  accentEdge: '#4A3A28',

  danger: '#FF5A4E',
  dangerWash: '#2E1A19',
  success: '#5FD3C2',
} as const;

/** Status chips: background + text, each pair readable on its own. */
export const statusColors: Record<string, { bg: string; fg: string; label: string }> = {
  lead: { bg: '#2C3036', fg: '#C9CDD2', label: 'Lead' },
  quoted: { bg: '#1E2A3A', fg: '#8DB8F2', label: 'Quoted' },
  accepted: { bg: '#3A2412', fg: '#FF9B4F', label: 'Accepted' },
  scheduled: { bg: '#123A36', fg: '#5FD3C2', label: 'Scheduled' },
  in_progress: { bg: '#3B3115', fg: '#F7C948', label: 'Working' },
  completed: { bg: '#1D3320', fg: '#7FD88A', label: 'Done' },
  invoiced: { bg: '#2A2140', fg: '#B9A4F5', label: 'Invoiced' },
  paid: { bg: '#2C3036', fg: '#C9CDD2', label: 'Paid' },
  declined: { bg: '#2C3036', fg: '#A9ADB3', label: 'Declined' },
  cancelled: { bg: '#2C3036', fg: '#A9ADB3', label: 'Cancelled' },
};

export const fonts = {
  body: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semibold: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
  display: 'BarlowCondensed_800ExtraBold',
  displayBold: 'BarlowCondensed_700Bold',
} as const;

/** Minimum touch target. Contractors may be wearing gloves. */
export const TOUCH = 56;
