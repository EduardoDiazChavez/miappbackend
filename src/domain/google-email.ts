const allowedGoogleEmailDomain = "mrm.com.ve";

export function isAllowedGoogleEmail(email: string): boolean {
  const [localPart, domain, ...extraParts] = email.trim().toLowerCase().split("@");
  return Boolean(localPart && domain === allowedGoogleEmailDomain && extraParts.length === 0);
}
