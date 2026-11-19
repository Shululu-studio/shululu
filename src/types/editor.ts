export type AspectRatio = '16:9' | '9:16' | '1:1';

export type SectionType =
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'pre-chorus'
  | 'intro'
  | 'outro';

export type EffectType =
  | 'none'
  | 'fade'
  | 'word-by-word'
  | 'progressive'
  | 'karaoke'
  | 'gentle-zoom'
  | 'slide-up'
  | 'cinematic'
  | 'line-crossfade'
  | 'subtle-drift'
  | 'neon-glow'
  | 'shimmer-gold'
  | 'elastic-pop'
  | 'horizontal-slide'
  | 'glitch-flash'
  | 'retro-pixel'
  | 'radial-burst';

export type AutoEffectStyle =
  | 'worship-serene'
  | 'contemporary-clean'
  | 'dynamic-stage'
  | 'minimal-editorial';

export type VocalRole = 'lead' | 'backing' | 'choir' | 'adlib';

export interface WordTiming {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  uncertain?: boolean;
}

export interface LyricLine {
  id: string;
  text: string;
  section: SectionType;
  vocalRole?: VocalRole;
  start: number;
  end: number;
  effect: EffectType;
  effectOverride: boolean;
  words: WordTiming[];
  confidence?: number;
  uncertain?: boolean;
  entranceDuration?: number;
  exitDuration?: number;
  delayBefore?: number;
  easing?: 'linear' | 'easeOutCubic' | 'easeInOutSine' | 'elastic';
}

export interface TypographyStyle {
  fontFamily: string;
  fontSize: number; // Base px at 1080p height reference
  fontWeight: number;
  color: string;
  highlightColor: string;
  align: 'left' | 'center' | 'right';
  lineSpacing: number; // Multiplier, e.g. 1.25
  letterSpacing: number; // px at 1080p reference
  positionX: number; // 0..1 normalized center X
  positionY: number; // 0..1 normalized center Y
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetY: number;
  outlineWidth: number;
  outlineColor: string;
  backgroundColor: string;
  backgroundOpacity: number; // 0..1
  backgroundPadding: number;
  opacity: number; // 0..1
}

export interface BackgroundConfig {
  type: 'solid' | 'gradient' | 'template' | 'image' | 'video';
  solidColor: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  templateId: string;
  mediaUrl?: string;
  mediaName?: string;
  scale: number; // 1.0..2.5
  offsetX: number; // -0.5..0.5
  offsetY: number; // -0.5..0.5
  dimOverlay: number; // 0..0.85
  blur: number; // 0..24 px
}

export interface SyncReport {
  method: 'ai-acoustic' | 'local-acoustic' | 'manual-tap' | 'lrc-import';
  confidence: number; // 0..1
  matchedPhrases: number;
  totalLines: number;
  warnings: string[];
  timestamp: number;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';
  opacity: number;
}

export interface VocalLayerSettings {
  visible: boolean;
  color: string;
  fontScale: number; // Relative to lead fontSize (0.5..0.95)
  positionX: number; // 0..1 normalized center X
  positionY: number; // 0..1 normalized center Y
}

export interface VocalLayersConfig {
  leadVisible: boolean;
  backing: VocalLayerSettings;
  backingUserConfigured?: boolean;
  choirVisible: boolean;
  choirColor: string;
  adlibVisible: boolean;
  adlibColor: string;
}

export type VocalLayersPatch = Omit<Partial<VocalLayersConfig>, 'backing'> & {
  backing?: Partial<VocalLayerSettings>;
};

export interface ProjectData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspectRatio: AspectRatio;
  duration: number;
  language?: string;
  audioFileName: string | null;
  audioMimeType: string | null;
  audioVolume?: number; // 0..2 linear gain multiplier (default 1 = 100%)
  vocalSeparation?: boolean;
  autoEffectsEnabled: boolean;
  autoEffectStyle: AutoEffectStyle;
  typography: TypographyStyle;
  vocalLayers?: VocalLayersConfig;
  background: BackgroundConfig;
  watermark: WatermarkConfig;
  lyrics: LyricLine[];
  syncReport: SyncReport | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  aspectRatio: AspectRatio;
  duration: number;
  lineCount: number;
  audioFileName: string | null;
}

export type LibraryCategory =
  | 'animation-presets'
  | 'typography-collections'
  | 'text-styles'
  | 'transitions'
  | 'background-templates'
  | 'editing-presets';

export interface LibraryPackManifestItem {
  id: string;
  title: string;
  category: LibraryCategory;
  version: string;
  description: string;
  itemCount: number;
  updatedAt: string;
  sizeLabel: string;
}

export interface LibraryPackData {
  id: string;
  version: string;
  category: LibraryCategory;
  title: string;
  presets: Array<{
    id: string;
    name: string;
    subtitle: string;
    autoEffectStyle?: AutoEffectStyle;
    effect?: EffectType;
    typography?: Partial<TypographyStyle>;
    background?: Partial<BackgroundConfig>;
  }>;
}

export interface CachedLibraryPack {
  id: string;
  version: string;
  downloadedAt: number;
  data: LibraryPackData;
}

export interface AlbumStylePreset {
  id: string;
  name: string;
  updatedAt: number;
  typography: TypographyStyle;
  background: BackgroundConfig;
  autoEffectStyle: AutoEffectStyle;
}

export type InspectorTab = 'lyrics' | 'typography' | 'effects' | 'background';
export type PreviewQuality = 'draft' | 'high';

