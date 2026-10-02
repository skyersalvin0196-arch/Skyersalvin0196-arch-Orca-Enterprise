import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orcaenterprise.app',
  appName: 'Orca Enterprise',
  webDir: 'android-web',
  server: {
    url: 'https://orca-enterprise-production-production.up.railway.app',
    cleartext: false
  }
};

export default config;
