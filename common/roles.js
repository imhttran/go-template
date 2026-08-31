// Ranked lowest to highest: a role satisfies a check for itself or anything below it.
export const ROLES = ["client", "staff", "admin"];

export function hasRole(userRole, minRole) {
  return ROLES.indexOf(userRole) >= ROLES.indexOf(minRole);
}
