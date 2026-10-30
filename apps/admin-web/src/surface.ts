export type Surface = 'tenant' | 'platform';

export function currentSurface(): Surface {
  return import.meta.env.VITE_SURFACE === 'platform' ? 'platform' : 'tenant';
}
