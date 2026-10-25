/** Client minimum. Hosted GoTrue must be set to the same or stricter value. */
export const MIN_PASSWORD_LENGTH = 8;

export function passwordMeetsPolicy(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function passwordPolicyMessage(): string {
  return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
}
