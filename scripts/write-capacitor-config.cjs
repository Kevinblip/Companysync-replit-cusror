'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mobile = JSON.parse(fs.readFileSync(path.join(root, 'mobile.config.json'), 'utf8'));
const appId = process.env.CAPACITOR_APP_ID || mobile.appId;
const appName = process.env.CAPACITOR_APP_NAME || mobile.appName;
const remoteUrl = String(process.env.CAPACITOR_SERVER_URL || '').trim();

const config = {
  appId,
  appName,
  webDir: 'dist-mobile',
  server: remoteUrl
    ? {
        url: remoteUrl,
        cleartext: remoteUrl.startsWith('http://'),
        androidScheme: 'https',
      }
    : {
        androidScheme: 'https',
        hostname: 'localhost',
        allowNavigation: [
          'getcompanysync.com',
          '*.getcompanysync.com',
          'accounts.google.com',
        ],
      },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#1e3a5f',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1e3a5f',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`[mobile] Wrote capacitor.config.json for ${appName} (${appId})`);
