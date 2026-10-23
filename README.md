# KeelWorks Newsletter QA — working prototype

A locally hosted web application: enter a public newsletter URL, click **Run QA Test**, review findings, and export an Excel defect log.

## Windows quick start
1. Install **Node.js LTS** from https://nodejs.org/ (if not already installed).
2. Unzip this folder, open the folder in File Explorer, type `cmd` in the address bar and press Enter.
3. Run `npm install`.
4. Run `npx playwright install chromium` (downloads the test browser).
5. Run `npm start`.
6. Open **http://localhost:3000** in Chrome or Edge.
7. Paste the newsletter URL, click **Run QA Test**, then **Export Excel report**.

Stop the server with Ctrl+C.

## Included checks
- Desktop (1440px), tablet (768px), mobile (390px) layout and horizontal overflow.
- Visible paragraph and H1–H3 font sizes and line heights, using **provisional** reference values.
- Broken images, missing alt attributes, potentially stretched images.
- Placeholder links, heading jumps, axe-core automated accessibility findings.
- Excel export with defect ID, category, defect, description, solution, severity, viewport and status.

## Important limitations
- Typography references in `server.js` (`specs`) must be validated against the approved Figma Design System. These are **not confirmed** Figma values.
- Visual differences from Figma, correct image *cropping*, copyediting, spelling, grammar, tone, and factual accuracy are not automatically checked in v1.
- This version checks placeholder links but **does not follow every external link** or check HTTP status codes.
- It does not automatically check the exact banner ratio specified by the design system; it detects likely intrinsic-image distortion.
- A scan can take 30–90 seconds. Some websites may block automated browsers.
- The built-in URL checks help restrict private network access, but this prototype is **for trusted local use only**. Do not expose publicly without authentication, rate limits, redirect/DNS protections, and deployment hardening.
- The Excel export is generated from the latest scan stored in process memory and disappears when the server restarts.

## Next enhancements
- Import/export approved design tokens and banner aspect ratio from the Figma library.
- Screenshot baseline comparison and image crop checks.
- Grammar and spelling integration with a self-hosted LanguageTool service.
- Broken external link validation, reviewer status, and issue triage.
