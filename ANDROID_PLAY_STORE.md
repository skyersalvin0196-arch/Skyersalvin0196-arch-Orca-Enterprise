# Orca Enterprise — Google Play packaging

The Android wrapper is configured as a Capacitor app using the live Orca Enterprise service.

- Application ID: `com.orcaenterprise.app`
- App name: `Orca Enterprise`
- Production URL: https://orca-enterprise-production-production.up.railway.app
- Build workflow: `.github/workflows/android-release.yml`
- Privacy policy: https://orca-enterprise-production-production.up.railway.app/privacy.html

## Current state

The repository is configured to build a **signed release AAB** through GitHub Actions. The workflow reads the protected signing material from GitHub Actions secrets and removes the temporary keystore after the build.

Required repository secrets:

- `ORCA_KEYSTORE_BASE64`
- `ORCA_KEYSTORE_PASSWORD`
- `ORCA_KEY_ALIAS`
- `ORCA_KEY_PASSWORD`

No keystore or signing password is stored in the repository.

**Important:** a successful workflow run still needs to be completed and verified before the AAB should be uploaded to Google Play.

## Google Play preparation

Google Play also requires store-listing and policy material, including:

- 512×512 application icon and Android launcher/adaptive icon assets
- Phone screenshots for the store listing
- Privacy policy URL
- App category and content declarations
- Data-safety information
- App-access information if reviewers need a login
- Release AAB signed with the app's release key

The production app remains **free to customers**; this Android wrapper does not add a subscription or paywall.

## Payment disclosure

Orca Enterprise currently sends customers to the configured Lynk payment link. The app records the customer's payment action as **pending verification**; it does not claim automatic Lynk transaction verification unless a supported Lynk API/webhook is connected.

## Release checklist

1. Confirm all four GitHub Actions signing secrets are configured.
2. Run the Android release workflow and verify the signed AAB artifact is produced.
3. Test the release build on Android.
4. Prepare the Play Store icon, screenshots, description, and declarations.
5. Create/configure the Google Play Console app using application ID `com.orcaenterprise.app`.
6. Add the privacy policy URL above.
7. Complete the Data safety and content declarations.
8. Upload the verified release AAB and follow Play Console's release/signing prompts.
