/**
 * Role DTO returned by `listRolesFn` (built-ins + custom roles) — shared
 * by /admin/roles (the permission matrix editor) and /admin/users (the
 * role pickers). Not a `defineList` module: the roles page is not a data
 * table, the DTO lives here only because both pages need the same shape.
 */
export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
  builtIn: boolean;
}
