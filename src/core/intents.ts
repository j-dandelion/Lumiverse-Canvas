import type { TabKey, Side, DrawerSide, ObservedWorld } from './model'

export type Intent =
  | { readonly t: 'move';        readonly key: TabKey; readonly to: Side; readonly index: number; readonly activateDest: boolean }
  | { readonly t: 'reorder';     readonly key: TabKey; readonly side: Side; readonly index: number }
  | { readonly t: 'setHidden';   readonly key: TabKey; readonly hidden: boolean }
  | { readonly t: 'activate';    readonly key: TabKey; readonly side: Side }
  | { readonly t: 'syncActive';  readonly primary: TabKey | null; readonly secondary: TabKey | null }
  | { readonly t: 'setDrawer';   readonly side: Side; readonly open?: boolean; readonly width?: number }
  | { readonly t: 'swapSides' }
  | { readonly t: 'syncFromHost'; readonly observed: ObservedWorld }
