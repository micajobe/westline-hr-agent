import { AUDIENCES, audienceApplies, type Audience } from '@westline/shared';
import type { Viewer } from '../types.js';

/**
 * The audience tags a viewer may read. This is the *only* place the viewer's class and scope turn
 * into a retrieval filter, so `policy-mcp` cannot enforce it any other way. Anonymous viewers
 * (no acting person) get `all` and nothing else, per PRD §6.1.
 */
export function permittedAudiences(viewer: Viewer): Audience[] {
  if (viewer.workforce_class === null) return ['all'];
  return AUDIENCES.filter((a) => audienceApplies(a, viewer.workforce_class, viewer.scope));
}

export function canRead(audience: Audience, viewer: Viewer): boolean {
  return permittedAudiences(viewer).includes(audience);
}
