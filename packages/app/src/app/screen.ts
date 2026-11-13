import type { ComponentType } from 'react';

export type NavGroup = 'Operations' | 'Response center' | 'Control & safety' | 'People & System';

/** One entry per screen: drives the router, the sidebar and the top bar title. */
export interface ScreenDef {
  id: string;
  path: `/${string}`;
  label: string;
  icon: string;
  group: NavGroup;
  /**
   * What the screen needs from Lefi Brain: the endpoint it loads first, and the Brain module that
   * will serve it. Against the real Brain, a screen whose endpoint is not in its OpenAPI says so
   * instead of showing anything (ADR-049); against the mock it shows labelled sample data.
   */
  brain: { endpoint: string; module: string };
  /**
   * The screen's version built only on what the real Lefi Brain serves (generated types). Used
   * against the real Brain when `endpoint` is in its OpenAPI; the mock keeps showing the design
   * with labelled sample data (ADR-049, ADR-052).
   */
  live?: { endpoint: string; component: ComponentType };
  /** Permission the Brain must grant for the screen to be shown. */
  permission: string;
  title: string;
  subtitle: string;
  component: ComponentType;
}
