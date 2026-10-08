// The mark-up colours of the feedback annotator. They live in one file because a <canvas> 2D context
// takes a resolved colour string, never a CSS variable (so they cannot be semantic tokens), and they
// are deliberately theme-invariant: a mark must stay legible in the screenshot whichever theme the
// reader is in. The same trio as MarineSensitivity/atlas and CalCOFI explore.
export interface MarkColor {
  id   : string
  hex  : string
  label: string
}

export const MARK_COLORS: MarkColor[] = [
  { id: 'pink',   hex: '#ff2d95', label: 'Pink' },
  { id: 'yellow', hex: '#ffd60a', label: 'Yellow' },
  { id: 'blue',   hex: '#4dabf7', label: 'Blue' },
]

/**
 * Pink is the default: against the light Esri basemaps (pale grey and blue) and the dark ones alike it
 * keeps more contrast than yellow (1.4:1 on white) or blue (which melts into ocean tones), and no
 * ERDDAP colour ramp used here ends in that hue.
 */
export const DEFAULT_MARK_COLOR = MARK_COLORS[0].hex
