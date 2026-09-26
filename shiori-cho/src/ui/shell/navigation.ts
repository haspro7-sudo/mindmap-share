// Route relationships used by the header (back target) and the bottom navigation (active section).
import type { Route } from '../../core/route';

export type NavSection = 'home' | 'code' | 'settings';

/** Top-level routes (bottom-nav destinations): no back button. */
export function isTopLevel(route: Route): boolean {
  return route.name === 'home' || route.name === 'code' || route.name === 'settings';
}

/** Where 「戻る」 goes when there is no in-app history to go back to. */
export function parentRoute(route: Route): Route {
  switch (route.name) {
    case 'workEdit':
      return { name: 'work', id: route.id, tab: 'progress' };
    case 'studio':
    case 'help':
      return { name: 'settings' };
    case 'studioProject':
      return { name: 'studio' };
    case 'studioPreview':
      return { name: 'studioProject', id: route.id, tab: 'check' };
    default:
      return { name: 'home' };
  }
}

/** Bottom-nav section a route belongs to (for the highlighted item). */
export function sectionOf(route: Route): NavSection | null {
  switch (route.name) {
    case 'home':
    case 'add':
    case 'work':
    case 'workEdit':
      return 'home';
    case 'code':
    case 'unlock':
      return 'code';
    case 'settings':
    case 'studio':
    case 'studioProject':
    case 'studioPreview':
    case 'help':
      return 'settings';
    default:
      return null;
  }
}

/** Routes rendered full-bleed without the bottom navigation. */
export function isFullscreen(route: Route): boolean {
  return route.name === 'demoPc';
}
