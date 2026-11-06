# Madar Wallet

Source code of Madar Wallet, a self-custody crypto wallet for Chrome (and other Chromium browsers) and Android.

- Website: https://madarwallet.app
- Security and transparency: https://madarwallet.app/security.html
- Chrome Web Store: https://chromewebstore.google.com/detail/focfidnkackpooheimajiiahmlojchcd

This repository is published so that anyone can read and check how the wallet works. It holds the code of the current
release; code comments are left out.

## How your keys are handled

- The 12-word recovery phrase is created on your device and never sent anywhere.
- It is stored encrypted with your password (scrypt + AES-256-GCM, see `src/core/vault.ts`).
- Every transaction is signed inside the wallet; servers only relay public data and signed transactions.

## Build

```bash
npm install
npm run build          # browser extension -> dist/ (load it unpacked in chrome://extensions)
npm run build:android  # web part of the Android app -> dist-android/
```

## Report a security issue

Email contact@madarwallet.app with the subject "Security". Please include the steps to reproduce and do not test against
other people's funds.

## License

PolyForm Noncommercial License 1.0.0 (see `LICENSE`). You may read, study and test the code; commercial use is not allowed.
