import {
  AutoEffectStyle,
  BackgroundConfig,
  EffectType,
  ProjectData,
  SectionType,
  TypographyStyle,
} from '../types/editor';

export interface FontOption {
  family: string;
  label: string;
  category: 'Gospel & Worship' | 'Contemporary' | 'Editorial' | 'Stage & Bold';
  weights: number[];
}

export const CURATED_FONTS: FontOption[] = [
  {
    family: 'Instrument Serif',
    label: 'Instrument Serif',
    category: 'Editorial',
    weights: [400],
  },
  {
    family: 'Syne',
    label: 'Syne',
    category: 'Contemporary',
    weights: [500, 600, 700, 800],
  },
  {
    family: 'Space Grotesk',
    label: 'Space Grotesk',
    category: 'Contemporary',
    weights: [400, 500, 600, 700],
  },
  {
    family: 'Italiana',
    label: 'Italiana',
    category: 'Gospel & Worship',
    weights: [400],
  },
  {
    family: 'Cormorant Garamond',
    label: 'Cormorant Garamond',
    category: 'Gospel & Worship',
    weights: [500, 600, 700],
  },
  {
    family: 'Playfair Display',
    label: 'Playfair Display',
    category: 'Gospel & Worship',
    weights: [500, 600, 700],
  },
  {
    family: 'Cinzel',
    label: 'Cinzel',
    category: 'Gospel & Worship',
    weights: [500, 600, 700],
  },
  {
    family: 'Lora',
    label: 'Lora',
    category: 'Gospel & Worship',
    weights: [500, 600, 700],
  },
  {
    family: 'Plus Jakarta Sans',
    label: 'Plus Jakarta Sans',
    category: 'Contemporary',
    weights: [400, 500, 600, 700, 800],
  },
  {
    family: 'Outfit',
    label: 'Outfit',
    category: 'Contemporary',
    weights: [400, 500, 600, 700],
  },
  {
    family: 'DM Sans',
    label: 'DM Sans',
    category: 'Contemporary',
    weights: [400, 500, 600, 700],
  },
  {
    family: 'Roboto',
    label: 'Roboto',
    category: 'Contemporary',
    weights: [400, 500, 700],
  },
  {
    family: 'Montserrat',
    label: 'Montserrat',
    category: 'Contemporary',
    weights: [400, 500, 600, 700, 800],
  },
  {
    family: 'IBM Plex Sans',
    label: 'IBM Plex Sans',
    category: 'Editorial',
    weights: [400, 500, 600, 700],
  },
  {
    family: 'Manrope',
    label: 'Manrope',
    category: 'Editorial',
    weights: [400, 500, 600, 700],
  },
  {
    family: 'Source Serif 4',
    label: 'Source Serif 4',
    category: 'Editorial',
    weights: [400, 600, 700],
  },
  {
    family: 'Oswald',
    label: 'Oswald',
    category: 'Stage & Bold',
    weights: [500, 600, 700],
  },
  {
    family: 'Bebas Neue',
    label: 'Bebas Neue',
    category: 'Stage & Bold',
    weights: [400],
  },
  {
    family: 'Archivo',
    label: 'Archivo',
    category: 'Stage & Bold',
    weights: [500, 600, 700],
  },
];

export interface BackgroundTemplateItem {
  id: string;
  name: string;
  subtitle: string;
  category: 'gospel-nature' | 'stage';
  imageUrl: string;
  recommendedTextColor: string;
  recommendedDim: number;
}

export const BACKGROUND_TEMPLATES: BackgroundTemplateItem[] = [
  {
    id: 'gospel-mountain-waterfall',
    name: 'Mountain Waterfall',
    subtitle: 'Full HD cascading waterfall across lush green mountain cliffs',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/mountain-waterfall.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-mountain-river',
    name: 'Mountain River Valley',
    subtitle: 'Crystal river winding beneath snow-capped mountain peaks',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/mountain-river.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-slow-river-rapids',
    name: 'Crystal River Rapids',
    subtitle: 'Sparkling mountain water flowing cleanly over river stones',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/slow-river-rapids.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-raindrops-lake',
    name: 'Calm Lake Raindrops',
    subtitle: 'Gentle rain ripples across serene mountain lake waters',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/raindrops-lake.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-white-birds',
    name: 'White Birds Flying',
    subtitle: 'White birds soaring gracefully across a clear blue sky',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/white-birds-sky.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-birds-soaring',
    name: 'Seabird Soaring Over Water',
    subtitle: 'Graceful bird gliding above sunlit open ocean horizon',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/seabird-over-water.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-swans-river',
    name: 'White Swans on River',
    subtitle: 'Peaceful white swans gliding along tranquil sunlit waters',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/swans-river.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-forest-stream',
    name: 'Rocky Forest Stream',
    subtitle: 'Clear mountain stream flowing over mossy woodland rocks',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/forest-river-sunbeams.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-sunbeams-clouds',
    name: 'Glory Twilight Clouds',
    subtitle: 'Glowing amber sunset light across deep evening clouds',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/sunbeams-clouds.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-sunrise-clouds',
    name: 'Golden Dawn Horizon',
    subtitle: 'Warm glowing morning sun rising above calm horizon',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/heavenly-clouds-sunrise.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.14,
  },
  {
    id: 'gospel-clouds-blue-sky',
    name: 'White Clouds Blue Sky',
    subtitle: 'Bright white clouds in deep blue heavens',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/white-clouds-sky.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.18,
  },
  {
    id: 'gospel-wind-clouds-sky',
    name: 'Heavenly Wind & Clouds',
    subtitle: 'Fresh high-altitude cloudscape across an open sky',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/blue-sky-clouds.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.18,
  },
  {
    id: 'gospel-alpine-mountains',
    name: 'Alpine Peaks & Mist',
    subtitle: 'Majestic sunlit mountain range with valley mist',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/alpine-mountains.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.14,
  },
  {
    id: 'gospel-snowy-peaks-mist',
    name: 'Snowy Peaks & Glory Mist',
    subtitle: 'Morning mist across high snow-covered summits',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/snowy-peaks-mist.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-aerial-mountain-forest',
    name: 'Snowy Horizon Mountains',
    subtitle: 'Clear blue sky stretching across distant snowy peaks',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/aerial-mountain-forest.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-forest-rays',
    name: 'Forest Waterfall Pool',
    subtitle: 'Emerald waterfalls pouring into sunlit crystal woodland pool',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/forest-sunbeams.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.14,
  },
  {
    id: 'gospel-tranquil-forest',
    name: 'Tranquil Morning Woods',
    subtitle: 'Serene green forest canopy bathed in morning light',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/tranquil-forest.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.14,
  },
  {
    id: 'gospel-meadow-sunlight',
    name: 'Morning Forest Sunbeams',
    subtitle: 'Golden sunbeams breaking through quiet woodland meadow',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/meadow-sunlight.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-green-meadow',
    name: 'Starry Night Heavens',
    subtitle: 'Radiant starlight glowing across deep night heavens',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/green-meadow-clouds.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.14,
  },
  {
    id: 'gospel-tree-cloud-meadow',
    name: 'Misty Morning Meadow',
    subtitle: 'Soft morning sunlight glowing over misty green pasture',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/tree-cloud-meadow.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-white-flowers',
    name: 'White Lilies in Breeze',
    subtitle: 'Delicate pure white blossoms in crisp natural daylight',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/white-flowers-breeze.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.18,
  },
  {
    id: 'gospel-ocean-sunset',
    name: 'Mighty Roaring Falls',
    subtitle: 'Towering waterfall mist illuminated in full daylight',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/ocean-golden-sunset.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-stunning-sea-sunset',
    name: 'Radiant Sea Sunset',
    subtitle: 'Amber glow stretching across wide peaceful ocean waters',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/sea-sunset-horizon.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-beach-amber-sunset',
    name: 'Golden Shore Waves',
    subtitle: 'Warm evening sunlight meeting calm shoreline surf',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/beach-amber-sunset.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.15,
  },
  {
    id: 'gospel-sea-sunrise',
    name: 'Morning Sun Over Sea',
    subtitle: 'Bright morning sun rising above tranquil coastal peaks',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/mountain-sea-sunrise.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-wooden-pier-water',
    name: 'Still Waters Wooden Pier',
    subtitle: 'Quiet wooden dock leading over mirror-calm reflection waters',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/wooden-pier-water.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-sunny-bay-aerial',
    name: 'Crystal Bay Waters',
    subtitle: 'Panoramic view over bright emerald sea and coastal hills',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/sunny-bay-aerial.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-savanna-lake',
    name: 'Golden Grass & Lake',
    subtitle: 'Peaceful reflective lake framed by tall golden reeds',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/savanna-lake.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.16,
  },
  {
    id: 'gospel-snowy-moon-sky',
    name: 'Full Moon Silent Pines',
    subtitle: 'Luminous full moon shining above quiet snow-draped pines',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/snowy-moon-sky.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.14,
  },
  {
    id: 'gospel-candles',
    name: 'Sanctuary Candlelight',
    subtitle: 'Warm glowing worship candles in serene dark stillness',
    category: 'gospel-nature',
    imageUrl: '/backgrounds/thumbs/sanctuary-candles.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.12,
  },
  {
    id: 'stage-amber',
    name: 'Sanctuary Stage Amber',
    subtitle: 'Warm overhead stage spotlight in charcoal mist',
    category: 'stage',
    imageUrl: '/backgrounds/stage/bg_stage_amber_1794560553967.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.25,
  },
  {
    id: 'midnight-velvet',
    name: 'Midnight Horizon',
    subtitle: 'Deep indigo twilight over calm open water',
    category: 'stage',
    imageUrl: '/backgrounds/stage/bg_midnight_velvet_1794560553220.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.2,
  },
  {
    id: 'cathedral-light',
    name: 'Morning Sanctuary Stone',
    subtitle: 'Travertine stone washed in warm sunlight',
    category: 'stage',
    imageUrl: '/backgrounds/stage/bg_cathedral_light_1794560555091.jpg',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.42,
  },
  {
    id: 'studio-linen',
    name: 'Charcoal Studio Matte',
    subtitle: 'Tactile dark slate studio surface with key light',
    category: 'stage',
    imageUrl: '/backgrounds/stage/bg_studio_linen_1794560554878.jpg',
    recommendedTextColor: '#F8FAFC',
    recommendedDim: 0.22,
  },
  {
    id: 'coral-stage',
    name: 'Coral Glow Stage',
    subtitle: 'Vibrant coral ambiance stage background',
    category: 'stage',
    imageUrl: '/assets/aistudio/image_2e14c03f.png',
    recommendedTextColor: '#FFFFFF',
    recommendedDim: 0.2,
  },
];

export const GRADIENT_PRESETS = [
  { id: 'slate-depth', name: 'Slate Depth', from: '#0F172A', to: '#1E293B', angle: 160 },
  { id: 'warm-obsidian', name: 'Warm Obsidian', from: '#141210', to: '#2B231D', angle: 145 },
  { id: 'deep-ocean', name: 'Deep Ocean', from: '#0A192F', to: '#112240', angle: 180 },
  { id: 'dusk-plum', name: 'Evening Plum', from: '#1A1423', to: '#2D1E2F', angle: 135 },
  { id: 'forest-night', name: 'Pine Shadow', from: '#0D1B1E', to: '#1B2D2A', angle: 155 },
  { id: 'stone-mist', name: 'Warm Stone', from: '#23201E', to: '#3A3530', angle: 165 },
];

export const EFFECT_OPTIONS: Array<{
  value: EffectType;
  label: string;
  description: string;
}> = [
  { value: 'fade', label: 'Smooth Fade', description: 'Gentle opacity entrance and exit' },
  {
    value: 'word-by-word',
    label: 'Word-by-Word',
    description: 'Reveals each word at its exact timing',
  },
  {
    value: 'karaoke',
    label: 'Karaoke Highlight',
    description: 'Progressive colour fill across active words',
  },
  {
    value: 'progressive',
    label: 'Progressive Wipe',
    description: 'Continuous horizontal line illumination',
  },
  {
    value: 'cinematic',
    label: 'Cinematic Reveal',
    description: 'Tracking contraction with soft fade',
  },
  {
    value: 'slide-up',
    label: 'Slide Up',
    description: 'Clean upward settle into resting baseline',
  },
  {
    value: 'gentle-zoom',
    label: 'Gentle Zoom',
    description: 'Subtle forward scale drift over phrase duration',
  },
  {
    value: 'line-crossfade',
    label: 'Smooth Line Transition',
    description: 'Overlapping crossfade between consecutive lines',
  },
  {
    value: 'subtle-drift',
    label: 'Subtle Drift',
    description: 'Minimal atmospheric vertical float',
  },
  { value: 'none', label: 'Static Cut', description: 'Immediate crisp appearance' },
  { value: 'neon-glow', label: 'Neon Cyber Glow', description: 'Backlit radiant neon bloom halo' },
  { value: 'shimmer-gold', label: 'Gold Foil Shimmer', description: 'Specular metallic light sweep across text' },
  { value: 'elastic-pop', label: 'Elastic Pop Spring', description: 'Bouncy spring settlement entrance' },
  { value: 'horizontal-slide', label: 'Horizontal Slide', description: 'Smooth horizontal slide entrance' },
];

export const AUTO_EFFECT_STYLE_OPTIONS: Array<{
  value: AutoEffectStyle;
  label: string;
  description: string;
}> = [
  {
    value: 'worship-serene',
    label: 'Worship & Acoustic',
    description: 'Cinematic fades on verses, karaoke glow on choruses',
  },
  {
    value: 'contemporary-clean',
    label: 'Contemporary Pop',
    description: 'Crisp slide transitions and word-by-word chorus emphasis',
  },
  {
    value: 'dynamic-stage',
    label: 'Dynamic Stage',
    description: 'High-clarity karaoke highlighting and subtle zoom bridges',
  },
  {
    value: 'minimal-editorial',
    label: 'Minimal Editorial',
    description: 'Restrained line crossfades and progressive text reveals',
  },
];

export const SECTION_LABELS: Record<SectionType, string> = {
  intro: 'Intro',
  verse: 'Verse',
  'pre-chorus': 'Pre-Chorus',
  chorus: 'Chorus',
  bridge: 'Bridge',
  outro: 'Outro',
};

export const SECTION_COLORS: Record<SectionType, string> = {
  intro: '#64748B',
  verse: '#3B82F6',
  'pre-chorus': '#0EA5E9',
  chorus: '#D97706',
  bridge: '#10B981',
  outro: '#FB923C',
};

export const DEFAULT_TYPOGRAPHY: TypographyStyle = {
  fontFamily: 'Roboto',
  fontSize: 64,
  fontWeight: 600,
  color: '#F8FAFC',
  highlightColor: '#F59E0B',
  align: 'center',
  lineSpacing: 1.28,
  letterSpacing: 0.5,
  positionX: 0.5,
  positionY: 0.5,
  shadowBlur: 18,
  shadowColor: 'rgba(0, 0, 0, 0.72)',
  shadowOffsetY: 4,
  outlineWidth: 0,
  outlineColor: '#000000',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  backgroundPadding: 20,
  opacity: 1,
};

export const DEFAULT_BACKGROUND: BackgroundConfig = {
  type: 'solid',
  solidColor: '#0D0E11',
  gradientFrom: '#0F172A',
  gradientTo: '#1E293B',
  gradientAngle: 160,
  templateId: 'stage-amber',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dimOverlay: 0.25,
  blur: 0,
};

export function createNewProject(name = 'Untitled Project'): ProjectData {
  const now = Date.now();
  return {
    id: `proj_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
    aspectRatio: '16:9',
    duration: 0,
    audioFileName: null,
    audioMimeType: null,
    audioVolume: 1,
    vocalSeparation: false,
    autoEffectsEnabled: true,
    autoEffectStyle: 'worship-serene',
    typography: { ...DEFAULT_TYPOGRAPHY },
    background: { ...DEFAULT_BACKGROUND },
    lyrics: [],
    syncReport: null,
  };
}
