// src/components/layout/BrandLogo.js
import React from "react";
import { IS_DEVSPACE } from "config";

import { ReactComponent as IntraMindTextLight } from "assets/images/logo-text-fullcolor.svg";
import { ReactComponent as IntraMindTextDark } from "assets/images/logo-text-white.svg";
import { ReactComponent as IntraMindMarkLight } from "assets/images/logo-fullcolor.svg";
import { ReactComponent as IntraMindMarkDark } from "assets/images/logo-white.svg";

import { ReactComponent as DevSpaceTextLight } from "assets/images/devspace-text-fullcolor.svg";
import { ReactComponent as DevSpaceTextDark } from "assets/images/devspace-text-white.svg";
import { ReactComponent as DevSpaceMarkLight } from "assets/images/devspace-fullcolor.svg";
import { ReactComponent as DevSpaceMarkDark } from "assets/images/devspace-white.svg";

/**
 * One switch for the whole app's logo, so a re-brand touches this file and
 * nothing else. Both sets keep the same viewBox proportions, so callers'
 * existing sizing rules (`--logo-width` / `--logo-height`) still apply.
 *
 * Light/dark is NOT decided here — Header.css hides `.logo-light` or
 * `.logo-dark` by body class, so both variants are rendered and CSS picks.
 * Changing that to a JS check would break the theme toggle, which has no
 * React state.
 */
// Re-exported so brand-aware components import one module rather than
// reaching into config for the flag and here for the copy.
export { IS_DEVSPACE };

const SETS = {
  devspace: {
    textLight: DevSpaceTextLight,
    textDark: DevSpaceTextDark,
    markLight: DevSpaceMarkLight,
    markDark: DevSpaceMarkDark,
  },
  intramind: {
    textLight: IntraMindTextLight,
    textDark: IntraMindTextDark,
    markLight: IntraMindMarkLight,
    markDark: IntraMindMarkDark,
  },
};

const set = () => (IS_DEVSPACE ? SETS.devspace : SETS.intramind);

/** Wordmark, light theme. */
export function BrandLogoTextLight(props) {
  const Svg = set().textLight;
  return <Svg {...props} />;
}

/** Wordmark, dark theme. */
export function BrandLogoTextDark(props) {
  const Svg = set().textDark;
  return <Svg {...props} />;
}

/** Mark only, light theme. */
export function BrandLogoMarkLight(props) {
  const Svg = set().markLight;
  return <Svg {...props} />;
}

/** Mark only, dark theme. */
export function BrandLogoMarkDark(props) {
  const Svg = set().markDark;
  return <Svg {...props} />;
}

/** Product name, for headings and dialog titles. */
export const BRAND_NAME = IS_DEVSPACE ? "DEV SPACE" : "IntraMind";

/** Login hero line. */
export const BRAND_TAGLINE = IS_DEVSPACE
  ? "DEV SPACE — bản thử nghiệm giọng nói"
  : "IntraMind - Trợ lý ảo nội bộ";

/** Login sub-line. Says plainly that this is not the real system. */
export const BRAND_SUBTITLE = IS_DEVSPACE
  ? "Bản thử nghiệm — không phải hệ thống thật"
  : "Thông Minh - An Toàn - Tin Cậy";
