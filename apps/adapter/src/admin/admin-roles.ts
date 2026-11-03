/** 运营台角色：operator 可管业务页；admin 可改授权/敏感词等 */
export type AdminRole = 'admin' | 'operator';

export const ADMIN_ROLE_KEY = 'adminRole';

export function resolveAdminRole(
  user: string,
  cfg: {
    ADMIN_USER: string;
    ADMIN_OPERATOR_USER?: string;
  },
): AdminRole {
  if (cfg.ADMIN_OPERATOR_USER && user === cfg.ADMIN_OPERATOR_USER) return 'operator';
  if (user === cfg.ADMIN_USER) return 'admin';
  return 'admin';
}
