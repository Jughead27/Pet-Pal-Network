---
name: Auth Screens Architecture
description: Sign-in/sign-up screen implementation details, Clerk quirks, and SSO patterns for pshpsh.
---

## Sign-in state machine
`sign-in.tsx` uses a `Step` union type:
- `'credentials'` — email + password (default)
- `'resetEmail'` — forgot-password email entry
- `'resetCode'` — forgot-password code + new password
- `'secondFactor'` — device/client-trust email-code entry

## Clerk Client Trust / Device Verification
Clerk's "Attack Protection → Client Trust" feature returns `needs_second_factor` with `supportedSecondFactors: [{ strategy: 'email_code' }]` on unrecognised devices, independent of user MFA enrollment. Disabling it in the Clerk dashboard did NOT stop the demand (as of Jul 2026). The sign-in screen handles it: auto-calls `prepareSecondFactor({ strategy: 'email_code' })` and shows a code-entry step.

**Why:** Silently swallowing this status with a generic error was the original production blocker. Now it's handled inline.

**How to apply:** If Clerk ever returns `needs_second_factor`, check `supportedSecondFactors` for `email_code`. If found, call `prepareSecondFactor` and show the `secondFactor` step. If a different strategy appears (totp, phone_code), surface it honestly as an error string — do not build additional UI without a scope change.

## Password reset flow (Clerk SDK v2)
1. `signIn.create({ strategy: 'reset_password_email_code', identifier: email })` — sends code
2. `signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code })` — returns `needs_new_password`
3. `signIn.resetPassword({ password })` — returns `complete` with `createdSessionId`

## SSO / OAuth transfer pattern
`startSSOFlow` (from `useSSO`) returns `{ createdSessionId, setActive, signIn, signUp }`.

On **sign-in screen** (new Google user):
- `ssoSignIn?.firstFactorVerification?.status === 'transferable'` → `signUp!.create({ transfer: true })`

On **sign-up screen** (existing Google user):
- `ssoSignUp?.verifications?.externalAccount?.status === 'transferable'` → `signIn!.create({ transfer: true })`

Requires importing BOTH `useSignIn` and `useSignUp` in each auth screen.

## SSO redirect URL
`Linking.createURL('/sso-callback')` — works on native (custom scheme) and web (https domain).
`sso-callback.tsx` calls `WebBrowser.maybeCompleteAuthSession()` at module level to close OAuth popups.
The `(auth)/_layout.tsx` `isSignedIn` redirect then routes to `/(tabs)`.

## Error messages
Always use `err.errors?.[0]?.longMessage ?? err.errors?.[0]?.message`. Never hardcode generic copy.
Non-complete statuses must be surfaced with the actual status string — no silent failures.

## `AuthenticateWithRedirectCallback` NOT available
`@clerk/clerk-expo` v2.x does NOT export `AuthenticateWithRedirectCallback`. SSO callback is handled by `WebBrowser.maybeCompleteAuthSession()` + `isSignedIn` redirect in `_layout.tsx`.
