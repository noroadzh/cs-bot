/** 运营台角色：operator 可管业务页；admin 可改授权/敏感词等；role 存库可扩展 */
export type AdminRole = 'admin' | 'operator';

export const ADMIN_ROLE_KEY = 'adminRole';
export const ADMIN_USER_KEY = 'adminUser';

export interface AdminUserContext {
  id: string;
  username: string;
  roleCode: AdminRole;
}
