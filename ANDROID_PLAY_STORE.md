# Orca Enterprise — Google Play packaging

The Android wrapper is configured as a Capacitor app using the live Orca Enterprise service.

- Application ID: com.orcaenterprise.app
- App name: Orca Enterprise
- Production URL: https://orca-enterprise-production-production.up.railway.app
- Build workflow: .github/workflows/android-release.yml

## Current state

The repository can generate an Android release AAB through GitHub Actions. The workflow currently produces an **unsigned** AAB.

## Before Google Play upload

A Play App Signing/release signing key must be created and protected. Do not commit the keystore or passwords to this repository. Configure GitHub Actions secrets for the signing step, then change the workflow to sign the release AAB.

Google Play also requires store listing and policy material, including an application icon, screenshots, a privacy policy URL, content declarations, and the appropriate app-access information.

The production app remains free to customers; this wrapper does not add a subscription or paywall.
