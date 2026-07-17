const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_USER_ID_RE = /^\d{1,32}$/;

/** The lite artifact is consumed as a strict contract by browser extensions.
 * Keep legacy/corrupt database rows out instead of publishing one malformed
 * identity that causes clients to reject the entire snapshot. */
export function isArtifactIdentityValid(userId: string | null, handle: string): boolean {
  return (
    X_HANDLE_RE.test(handle) && (userId === null || userId === "" || X_USER_ID_RE.test(userId))
  );
}
