import { Theme } from './Theme.js'

// Theme variants. Each lists only what differs from its parent; the rest is inherited.

// Product and lookbook screens: a warmer, earthy-stone primary button. One token changes.
export class ShowroomTheme extends Theme {
  static id = 'showroom'
  static tokens = {
    glass: { strong: { bg: 'rgba(92, 80, 66, 0.88)' } },
  }
}
