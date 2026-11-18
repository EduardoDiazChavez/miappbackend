type GoogleUserClaims = {
  email: string;
  name?: string | null;
  subject: string;
};

export function buildNewGoogleUser(claims: GoogleUserClaims) {
  const [localPart] = claims.email.split("@");
  return {
    email: claims.email,
    name: claims.name?.trim() || localPart,
    role: "ADVISOR" as const,
    active: true,
    googleSubject: claims.subject,
  };
}
