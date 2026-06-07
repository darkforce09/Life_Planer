# Ladok Authentication: Failed Attempts Log

This document logs the various approaches we took to automate the Ladok login process, what specifically failed in each attempt, and the technical reasons why they didn't work.

## 1. Direct API / Basic Scraping
- **What Failed**: Initially, the bot attempted to bypass the SAML Single Sign-On (SSO) flow by interacting with Ladok's base endpoints or attempting a standard form login.
- **Why**: Ladok strictly enforces Shibboleth SAML SSO. There is no direct username/password form on Ladok itself; all users must authenticate through their respective university's Identity Provider (IdP) via the federated SeamlessAccess gateway.

## 2. SeamlessAccess Bypass with Incorrect Entity ID
- **What Failed**: We attempted to bypass the SeamlessAccess UI by forging the redirect URL that SeamlessAccess normally generates. We injected `entityID=https://idp.miun.se/adfs/services/trust` into the `return` parameter.
- **Why**: The `entityID` used was a guess based on standard Microsoft ADFS setups. Because this exact string was not registered in the SWAMID (Swedish Academic Identity) federation as Miun's official identifier, Ladok rejected the request with the error: `SAML2 SSO profile is not configured for relying party https://idp.miun.se/adfs/services/trust` (Unknown login service).

## 3. Playwright UI Interaction (Headless SeamlessAccess)
- **What Failed**: We attempted to exactly mimic the manual user flow: navigate to Ladok, click "Access through your institution", wait for the SeamlessAccess page (`service.seamlessaccess.org`), and type "Mid Sweden University" into the search box.
- **Why**: SeamlessAccess heavily relies on cross-site iframes and local storage APIs (specifically `ps_pbjmb`) to remember institutions. When running Playwright in a headless Chromium browser, `requestStorageAccess` permissions are strictly denied for security reasons. This caused the SeamlessAccess JavaScript to crash and render a completely blank white screen, preventing the search box (`#searchinput`) from ever appearing in the DOM. The script timed out waiting for an element that couldn't render.

---
**Current Solution**: Use the URL bypass method (Attempt #2) but inject the officially verified SWAMID identifier for Mid Sweden University: `entityID=https://miunidp.miun.se/idp/shibboleth`.
