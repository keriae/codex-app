import type { PermissionProfile, ReasoningEffort } from './protocol'

export const FULL_ACCESS_PERMISSION_PROFILE_ID = ':danger-full-access'

export function isFullAccessPermission(permission: string): boolean {
  const normalized = permission.replace(/^:/, '').toLowerCase()
  return normalized === 'danger-full-access' ||
    normalized === 'danger-no-sandbox' ||
    normalized === 'full-access'
}

export function restrictedPermissionFallback(
  profiles: readonly PermissionProfile[]
): string | null {
  const allowed = profiles.filter(
    (profile) => profile.allowed && !isFullAccessPermission(profile.id)
  )
  return allowed.find((profile) => profile.id === ':workspace')?.id || allowed[0]?.id || null
}

export function needsUltraFullAccessConfirmation(
  permission: string,
  currentEffort: ReasoningEffort,
  targetEffort: ReasoningEffort
): boolean {
  return isFullAccessPermission(permission) &&
    targetEffort === 'ultra' &&
    currentEffort !== 'ultra'
}
