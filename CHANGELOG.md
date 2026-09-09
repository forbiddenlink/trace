# Changelog

## [1.0.5](https://github.com/forbiddenlink/trace/compare/v1.0.4...v1.0.5) (2026-09-09)


### Bug Fixes

* **deps:** replace framer-motion with motion, keep the audit report ([#85](https://github.com/forbiddenlink/trace/issues/85)) ([9520818](https://github.com/forbiddenlink/trace/commit/952081867e516c1e5ab2573bd58674eddd1fac8e))
* **seo:** add robots.txt, sitemap.xml, llms.txt, and canonical tag ([#76](https://github.com/forbiddenlink/trace/issues/76)) ([5c998cf](https://github.com/forbiddenlink/trace/commit/5c998cf9ab743a9331fcf020e2555a3686917038))

## [1.0.4](https://github.com/forbiddenlink/trace/compare/v1.0.3...v1.0.4) (2026-09-03)


### Bug Fixes

* **deps:** replace dependency framer-motion with motion ^12.43.0 ([#61](https://github.com/forbiddenlink/trace/issues/61)) ([f29e0e1](https://github.com/forbiddenlink/trace/commit/f29e0e12b8f59aa9f8654771820631a3e52e8817))
* renovate config drift ([9be5bdc](https://github.com/forbiddenlink/trace/commit/9be5bdc1c7c9366c4ab5440d09891644af52b6ed))

## [1.0.3](https://github.com/forbiddenlink/trace/compare/v1.0.2...v1.0.3) (2026-09-02)


### Bug Fixes

* **ci:** let pnpm/action-setup read the version from packageManager ([928e17a](https://github.com/forbiddenlink/trace/commit/928e17ac66f7774d26caba0450af52c37e750d04))

## [1.0.2](https://github.com/forbiddenlink/trace/compare/v1.0.1...v1.0.2) (2026-08-29)


### Bug Fixes

* **deps:** move resolution overrides to package.json and add missing patches ([#53](https://github.com/forbiddenlink/trace/issues/53)) ([efaa4f4](https://github.com/forbiddenlink/trace/commit/efaa4f4da1e66bbf810cc2a8d888eddd1bf42702))

## [1.0.1](https://github.com/forbiddenlink/trace/compare/v1.0.0...v1.0.1) (2026-08-29)


### Bug Fixes

* **ci:** remove pnpm/action-setup version pin to avoid packageManager conflict ([#51](https://github.com/forbiddenlink/trace/issues/51)) ([acf4b67](https://github.com/forbiddenlink/trace/commit/acf4b6729d1a9e9716da8b07068b392539366ca5))

## 1.0.0 (2026-08-09)


### Features

* accessibility score + one-click fix on generated components ([b4b9bf8](https://github.com/forbiddenlink/trace/commit/b4b9bf8f782780e7f149b1fb9b333798887be5e8))
* component improvements ([d59d79d](https://github.com/forbiddenlink/trace/commit/d59d79d66ed6d4b2a188df4bc834136206617c42))
* editorial hero empty state with an ambient trace demonstration ([8507ccf](https://github.com/forbiddenlink/trace/commit/8507ccffcfe64ea186398299a386a714d1d98479))
* example gallery (zero-cred demo) + compare slider, export, dark mode ([ca6959b](https://github.com/forbiddenlink/trace/commit/ca6959b6a4fcb3685a30af6312b3fbd9367c03c2))
* extract hooks, add accessibility features and E2E tests ([e96ae08](https://github.com/forbiddenlink/trace/commit/e96ae08d01578d0a41a9d46ab1f05dd702fa3de8))
* plotter generation sequence, craft polish, reliable a11y; drop grid background ([759fc93](https://github.com/forbiddenlink/trace/commit/759fc936c6055da0e7f4106d2d29672832a01b7c))
* precision-polish visual system ([806abfe](https://github.com/forbiddenlink/trace/commit/806abfe5bbf3f044471e0bbcfc43c059f97817c4))
* redesign to a precision-drafting visual system ([3664d2f](https://github.com/forbiddenlink/trace/commit/3664d2f74105736803301b2bf9136a2b28545237))
* refine-with-prompt, confidence-graded refine targets, draw-to-instruct ([8e96a94](https://github.com/forbiddenlink/trace/commit/8e96a94c2508efba98f4b164ccc77b84dae01d29))
* revive abandoned project as Trace — screenshot to live component studio ([acf6f9c](https://github.com/forbiddenlink/trace/commit/acf6f9c0a7c6f28b021f5ea8c46b895c730cefc0))
* self-repair loop + make Algolia optional, drop dead deps ([93053ce](https://github.com/forbiddenlink/trace/commit/93053ce75853106e30302d7609a008eb9d7784c0))
* **sentry:** add error tracking to Vite SPA ([3c60cd6](https://github.com/forbiddenlink/trace/commit/3c60cd621d4d8e3a843c3de03ee400f8a0c6c651))
* trace-line signature, bounding boxes, honest grounding ([8203476](https://github.com/forbiddenlink/trace/commit/820347642c37a1b66e6e8b371e1231031962b5f0))
* **ui:** surface instant examples in the first viewport + grounding trust readout ([22ee1ca](https://github.com/forbiddenlink/trace/commit/22ee1cadd1f2e8ae5d14f2ca27fc05daaa63b14f))


### Bug Fixes

* add required maxDuration to TriggerConfig ([7ff84e3](https://github.com/forbiddenlink/trace/commit/7ff84e33836f15228195251294520110a5e1b462))
* align package.json name with project identity ([f9338f3](https://github.com/forbiddenlink/trace/commit/f9338f3053882fccc39378685f178a6c065b6d4a))
* **api:** best-effort per-IP rate limit on the public generate endpoint ([1fee335](https://github.com/forbiddenlink/trace/commit/1fee3353412c22a6284a8fc1f2991ac00c09e5e8))
* **api:** cap Gemini 2.5 thinking budget so structured output isn't truncated ([2b8e005](https://github.com/forbiddenlink/trace/commit/2b8e005c139ffe902f30150db21ccbe1a450c696))
* **build:** migrate PostCSS config to @tailwindcss/postcss for v4 compatibility ([fb8f520](https://github.com/forbiddenlink/trace/commit/fb8f52096074135fcb2e7110cfef3b5c6c6a8141))
* bundle catalog as a module + lazy-load esbuild for serverless ([e16cf54](https://github.com/forbiddenlink/trace/commit/e16cf549ed40bf5360f12d949ed8c8e311adac16))
* cap cookie override below v2 to prevent @supabase/ssr build break ([f72b4d3](https://github.com/forbiddenlink/trace/commit/f72b4d360985e1ab89d0b9d2eb32e4a68985bc28))
* **deps:** add pnpm-workspace overrides for security patches ([2edb756](https://github.com/forbiddenlink/trace/commit/2edb7563afac61b73a1beaa99f3228910a8305eb))
* **deps:** pin pnpm and keep security overrides in package.json ([f728d1f](https://github.com/forbiddenlink/trace/commit/f728d1fe5e4767f5b4d44b0f73bf268ed56fc4ea))
* load Tailwind in the Sandpack preview so generated components are styled ([f483822](https://github.com/forbiddenlink/trace/commit/f483822c769d5e197c6dc8cf5953a58d381f7f4b))
* make the serverless function fully self-contained ([37a25c9](https://github.com/forbiddenlink/trace/commit/37a25c99e63887dae8469ec7d44bbdc141140539))
* move OpenAI key server-side and harden CI pipeline ([e6c4911](https://github.com/forbiddenlink/trace/commit/e6c49114c6042d81abd14c2ec178829417b59df7))
* narrow undici override to &lt;8 to satisfy jsdom@29 dependency ([#38](https://github.com/forbiddenlink/trace/issues/38)) ([c187100](https://github.com/forbiddenlink/trace/commit/c18710081bf402112cc1f599f6499d9090138a5c))
* never echo provider error details to the client ([bc4a9cc](https://github.com/forbiddenlink/trace/commit/bc4a9cc20fdb9acd67c73338ad5f9bc1d6095d46))
* patch all dependency vulnerabilities ([706ecf6](https://github.com/forbiddenlink/trace/commit/706ecf60cc54efee54d89e29b61035c190e7405a))
* patch minimatch + brace-expansion ReDoS via scoped overrides ([4923a45](https://github.com/forbiddenlink/trace/commit/4923a456f136cd6e2d35b7f773dce81860ed0fcf))
* re-trace preserves work on failure; persist dark-editor theme ([721b215](https://github.com/forbiddenlink/trace/commit/721b21537c643bd15fceda6142199a25e1f35af8))
* repair-on-examples crash, non-destructive errors, cost guards ([9d2e4ff](https://github.com/forbiddenlink/trace/commit/9d2e4ff6a28b7d435e3e4dd35134fdf685d55637))
* resolve CI failures — lint errors and broken overrides ([7afce5a](https://github.com/forbiddenlink/trace/commit/7afce5a601104b51eeadef86616430d5a939201a))
* resolve merge conflicts and patch security vulnerabilities ([0e6ee89](https://github.com/forbiddenlink/trace/commit/0e6ee8921304d5dbd0b3fe28e2e589cc9b518645))
* **security:** override shell-quote &gt;=1.8.4 (GHSA critical) ([#30](https://github.com/forbiddenlink/trace/issues/30)) ([19e8ce1](https://github.com/forbiddenlink/trace/commit/19e8ce1582831b714ff0028a99350dd9ec8e7edd))
* tablet ambient demo, full-width code tab, sample feedback, trace-line clarity ([8108755](https://github.com/forbiddenlink/trace/commit/81087556f7fade18963d93dc8323715379f9fa09))
* **ui:** only draw trace lines in the three-column layout ([36fdbdb](https://github.com/forbiddenlink/trace/commit/36fdbdbf212d7b96057a66d6b9e07d8010a6738b))
* **ui:** re-run the accessibility check after every generation ([d8599f7](https://github.com/forbiddenlink/trace/commit/d8599f78b08cf589c6a2f1eba1042a0a087ee887))
* use pnpm in CI instead of npm ([1b69fcc](https://github.com/forbiddenlink/trace/commit/1b69fcc5df220bdb59d93c235c593dae998c3c84))
