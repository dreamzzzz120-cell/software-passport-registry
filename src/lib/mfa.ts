import {
  EmailAuthProvider,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
  reauthenticateWithCredential,
  type MultiFactorResolver,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export function enrolledTotpFactors(user: User) {
  return multiFactor(user).enrolledFactors.filter(
    (factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID,
  );
}

export function hasTotpMfa(user: User | null): boolean {
  return Boolean(user && enrolledTotpFactors(user).length > 0);
}

export async function beginTotpEnrollment(user: User) {
  if (!user.emailVerified) {
    throw new Error('Verify your email address before enrolling an authenticator.');
  }
  const session = await multiFactor(user).getSession();
  return TotpMultiFactorGenerator.generateSecret(session);
}

export function totpQrUri(secret: Awaited<ReturnType<typeof TotpMultiFactorGenerator.generateSecret>>, email: string) {
  return secret.generateQrCodeUrl(email, 'Software Passport Registry');
}

export async function finishTotpEnrollment(
  user: User,
  secret: Awaited<ReturnType<typeof TotpMultiFactorGenerator.generateSecret>>,
  code: string,
  displayName = 'Authenticator app',
) {
  if (!/^\d{6}$/.test(code.trim())) throw new Error('Enter the current 6-digit authenticator code.');
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
  await multiFactor(user).enroll(assertion, displayName);
  await user.getIdToken(true);
}

export async function reauthenticatePassword(user: User, password: string) {
  if (!user.email) throw new Error('This account has no email credential available for re-authentication.');
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

export async function unenrollTotp(user: User, factorUid: string) {
  await multiFactor(user).unenroll(factorUid);
  await user.getIdToken(true);
}

export function getTotpResolver(error: unknown): MultiFactorResolver | null {
  if (!auth || (error as { code?: string })?.code !== 'auth/multi-factor-auth-required') return null;
  return getMultiFactorResolver(auth, error as Parameters<typeof getMultiFactorResolver>[1]);
}

export async function resolveTotpSignIn(
  resolver: MultiFactorResolver,
  factorUid: string,
  code: string,
) {
  if (!/^\d{6}$/.test(code.trim())) throw new Error('Enter the current 6-digit authenticator code.');
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(factorUid, code.trim());
  return resolver.resolveSignIn(assertion);
}
