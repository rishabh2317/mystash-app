import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

describe('Google OAuth client diagnostics', () => {
  it('does not alert or log full OAuth or redirect URLs', () => {
    const auth = readFileSync(join(ROOT, 'contexts/AuthContext.tsx'), 'utf8');
    assert.match(auth, /signInWithOAuth/);
    assert.match(auth, /oauthUrlDiagnostic/);
    assert.doesNotMatch(auth, /alert\(`redirectTo/);
    assert.doesNotMatch(auth, /alert\(data\?\.url/);
    assert.doesNotMatch(auth, /console\.log\('redirectTo ='/);
    assert.doesNotMatch(auth, /OAuth redirect URL \(allowlist/);
    assert.doesNotMatch(auth, /access_token && params\.refresh_token/);
    assert.match(auth, /completeAuthCallback/);
    assert.match(auth, /beginInAppAuthSession/);
    assert.match(auth, /supabaseAuthCallbackDeps/);
    const callback = readFileSync(join(ROOT, 'app/auth/callback.tsx'), 'utf8');
    assert.doesNotMatch(callback, /alert\(/);
    assert.doesNotMatch(callback, /setSession/);
    assert.match(callback, /completeAuthCallback/);
    assert.match(callback, /supabaseAuthCallbackDeps/);
    assert.match(callback, /token_hash/);
    const intent = readFileSync(join(ROOT, 'app/+native-intent.ts'), 'utf8');
    assert.match(intent, /rewriteNativeAuthCallbackPath/);
    const shared = readFileSync(join(ROOT, 'src/auth/supabaseAuthCallback.ts'), 'utf8');
    assert.match(shared, /exchangeCodeForSession/);
    assert.match(shared, /from '@\/src\/services\/supabase'/);
  });

  it('keeps password policy and callback routes aligned', () => {
    const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
    assert.match(config, /minimum_password_length = 8/);
    assert.match(config, /enable_confirmations = true/);
    assert.match(config, /mystash:\/\/auth\/callback/);
    const profile = readFileSync(join(ROOT, 'app/(tabs)/profile.tsx'), 'utf8');
    assert.match(profile, /forgot-password/);
    assert.match(profile, /MIN_PASSWORD_LENGTH/);
    assert.match(profile, /pendingConfirmationEmail/);
    assert.match(profile, /ProfileAuthForm/);
    assert.match(profile, /authStep/);
    assert.match(profile, /setAuthStep\('form'\)/);
    assert.match(profile, /setAuthStep\('welcome'\)/);
    assert.match(profile, /signInWithEmail/);
    assert.match(profile, /signUpWithEmail/);
    assert.match(profile, /signInWithGoogle/);
    assert.match(profile, /passwordMeetsPolicy/);
    assert.match(profile, /confirmPassword/);
  });

  it('keeps Profile auth presentation wired to existing submit and Google handlers', () => {
    const form = readFileSync(join(ROOT, 'components/profile/ProfileAuthForm.tsx'), 'utf8');
    assert.match(form, /auth_screen_signed_out_hero\.png/);
    assert.match(form, /auth_screen_hero\.png/);
    assert.match(form, /resizeMode="contain"/);
    assert.match(form, /WELCOME_ART/);
    assert.match(form, /FORM_ART/);
    assert.match(form, /artLayout/);
    assert.match(form, /AUTH_COPY\.landingHeadline/);
    assert.match(form, /AUTH_COPY\.formSignInTitle/);
    assert.match(form, /AUTH_COPY\.welcomeSignUp/);
    assert.match(form, /onOpenMode\('signin'\)/);
    assert.match(form, /onOpenMode\('signup'\)/);
    assert.match(form, /onChangeMode\('signup'\)/);
    assert.match(form, /onChangeMode\('signin'\)/);
    assert.match(form, /onForgotPassword/);
    assert.match(form, /onGoogle/);
    assert.match(form, /onSubmit/);
    assert.match(form, /AUTH_COPY\.displayName/);
    assert.match(form, /AUTH_COPY\.forgotPassword/);
    assert.match(form, /AUTH_COPY\.terms/);
    assert.match(form, /onChangeUsername/);
    assert.match(form, /onChangeConfirmPassword/);
    assert.match(form, /AUTH_COPY\.confirmPassword/);
    assert.doesNotMatch(form, /AUTH_COPY\.username/);
    assert.match(form, /variant="filled"/);
    assert.match(form, /variant="outlinePrimary"/);
    assert.match(form, /leadingIcon="logo-google"/);
    assert.match(form, /typeStyle\(tokens, 'link'\)/);
    assert.match(form, /typeStyle\(tokens, 'bodyMuted'\)/);
    assert.match(form, /fontFamily\.extraBold/);
    assert.doesNotMatch(form, /tokens\.color\.cta/);
    assert.doesNotMatch(form, /createPrimaryButtonStyle/);
    assert.doesNotMatch(form, /signInWithEmail/);
    assert.doesNotMatch(form, /signUpWithEmail/);
  });

  it('keeps creator activation on the User API rather than public.users', () => {
    const api = readFileSync(join(ROOT, 'src/services/userApi.ts'), 'utf8');
    assert.match(api, /activateCreatorAccount/);
    assert.match(api, /\/users\/me\/creator\/start/);
    assert.match(api, /\/users\/me\/creator\/complete/);
    assert.doesNotMatch(api, /\.from\(['"]users['"]\)/);
    const create = readFileSync(join(ROOT, 'app/(tabs)/create/index.tsx'), 'utf8');
    const hook = readFileSync(join(ROOT, 'src/hooks/useCreatorOnboarding.ts'), 'utf8');
    assert.doesNotMatch(create, /activateCreatorAccount/);
    assert.match(hook, /startCreatorOnboarding/);
    assert.match(hook, /completeCreatorOnboarding/);
    assert.doesNotMatch(hook, /activateCreatorAccount/);
  });
});
