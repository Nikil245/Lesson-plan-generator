---
name: Precision Engineering Dark
colors:
  surface: '#121315'
  surface-dim: '#121315'
  surface-bright: '#38393b'
  surface-container-lowest: '#0d0e10'
  surface-container-low: '#1b1c1e'
  surface-container: '#1f2022'
  surface-container-high: '#292a2c'
  surface-container-highest: '#343537'
  on-surface: '#e3e2e5'
  on-surface-variant: '#bacac5'
  inverse-surface: '#e3e2e5'
  inverse-on-surface: '#303033'
  outline: '#859490'
  outline-variant: '#3c4a46'
  surface-tint: '#3cddc7'
  primary: '#57f1db'
  on-primary: '#003731'
  primary-container: '#2dd4bf'
  on-primary-container: '#00574d'
  inverse-primary: '#006b5f'
  secondary: '#c6c6cb'
  on-secondary: '#2e3035'
  secondary-container: '#47494d'
  on-secondary-container: '#b7b8bd'
  tertiary: '#d9dae0'
  on-tertiary: '#2e3035'
  tertiary-container: '#bdbec4'
  on-tertiary-container: '#4b4d52'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#62fae3'
  primary-fixed-dim: '#3cddc7'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005047'
  secondary-fixed: '#e2e2e7'
  secondary-fixed-dim: '#c6c6cb'
  on-secondary-fixed: '#1a1c20'
  on-secondary-fixed-variant: '#45474b'
  tertiary-fixed: '#e2e2e9'
  tertiary-fixed-dim: '#c5c6cd'
  on-tertiary-fixed: '#191c20'
  on-tertiary-fixed-variant: '#45474c'
  background: '#121315'
  on-background: '#e3e2e5'
  surface-variant: '#343537'
typography:
  display:
    fontFamily: Geist
    fontSize: 56px
    fontWeight: '600'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  code:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
  space-2xl: 4rem
  space-3xl: 6rem
---

## Brand & Style

This design system expresses rigorous technical authority, deliberate craft, and focused clarity tailored for educators instructing in prompt engineering and generative AI architecture. 

- **Aesthetic Movement:** Technical Minimalism meets Precision Dark Mode. The interface rejects unnecessary decorative flair, avoiding glowing purple gradient mesh tropes and diffuse glassmorphism. It substitutes them with mechanical hairline borders, pure matte dark surfaces, and disciplined spatial cadence.
- **Brand Personality:** Authoritative, razor-sharp, pedagogical, and highly utilitarian.
- **Target Audience:** Prompt engineers, university professors, enterprise AI instructors, and curriculum developers who value high information density presented with serene typographical balance.
- **Emotional Response:** Inspires quiet confidence, frictionless instructional planning, and the tactile feel of an ultra-premium software workbench.

## Colors

The palette is rooted in ultra-deep tonal layering with an electric, pinpoint emerald-teal accent:

- **Canvas Background (`#0B0C0E`):** A near-black void that establishes deep optical focus without pure pitch-black harshness.
- **Surface Elevation 1 (`#141518`):** The primary container background for large layout divisions, structural cards, and code workbench modules.
- **Surface Elevation 2 (`#1C1E22`):** Interactive inputs, nested cards, active states, and floating navigation bars.
- **Hairline Structural Border (`#26282D`):** Deliberate 1px boundary line used to define containment without visual weight.
- **Primary Text (`#F2F3F5`):** Crisp high-contrast chalk-white for titles, body copy, and prominent UI indicators.
- **Secondary Text (`#9AA0A9`):** Neutral titanium-grey for metadata, secondary descriptors, captions, and structural labels.
- **Accent Emerald-Teal (`#2DD4BF`):** Reserved exclusively for core conversion actions, active pill highlights, status pings, and inline pedagogical citation numbering.

## Typography

The type system relies on **Geist** to deliver a neutral, engineered presence with exceptional legibility across dense curricula schedules and technical prompts.

- **Tracking Strategy:** Headings feature tight negative letter-spacing (`-0.02em` to `-0.03em`) to create a solid, modern editorial lockup. Body text maintains slight negative or neutral tracking to preserve reading pace across prolonged documentation.
- **Hierarchy Allocation:**
  - `display`: Landing hero value propositions.
  - `headline-lg` & `headline-md`: Section headers and major curriculum feature titles.
  - `body-lg`: Lead marketing paragraphs.
  - `body-md`: Standard component copy, module breakdowns, and syllabus outlines.
  - `label-sm` & `label-md`: Interactive pills, table headers, and citation badges.
  - `code`: Monospaced tokens, AI parameter readouts (`temperature`, `top_p`), and raw prompt variables.

## Layout & Spacing

A 12-column responsive fluid grid configured for high breathing room, intentional negative space, and disciplined layout rhythm:

- **Desktop (1024px+):** 12 columns, `1.5rem` gutters, `3rem` side margins, standard page max-width capped at `1200px` for optimal scanning.
- **Tablet (768px - 1023px):** 8 columns, `1.25rem` gutters, `2rem` side margins.
- **Mobile (< 768px):** 4 columns, `1rem` gutters, `1.25rem` side margins. Multi-column metric displays reflow into single-column vertical stacks.
- **Vertical Spacing Cadence:** Landing page sections utilize generous breathing room (`space-3xl` / 96px) to maintain a minimalist, uncluttered feel. Feature groups use `space-2xl` (64px) for distinct separation.

## Elevation & Depth

This system avoids blurry drop shadows, soft ambient colored glows, and frosted glass backdrops. Depth is rendered purely through surface luminosity stepping and crisp 1px perimeter definition:

- **Base Layer (Elevation 0):** Pure canvas `#0B0C0E`.
- **Card & Section Layer (Elevation 1):** Flat `#141518` with a continuous `1px solid #26282D` boundary line.
- **Interactive Layer (Elevation 2):** Flyout drawers, dropdown menus, and nested panels step forward to `#1C1E22` paired with `1px solid #26282D`.
- **State Changes:** Hovering over an elevation container does not elevate via Y-axis translation or shadow expansion; instead, the border transitions seamlessly from `#26282D` to `#3E4249`, providing immediate tactile feedback without breaking layout planes.

## Shapes

The shape architecture relies on a calculated contrast between structural architectural containers and pill-shaped interactive components:

- **Cards & Modules:** Generous `20px` to `24px` radius (`rounded-xl`), creating large, smooth-cornered content pods that soften technical subject matter.
- **Interactive Controls:** Buttons, category chips, status tags, and citation markers adopt full pill radii (`rounded-full` / `9999px`).
- **Inner Form Controls:** Text fields and code snippet containers utilize a tighter `8px` to `12px` radius to maintain geometric alignment with the underlying grid.

## Components

### Buttons
- **Primary:** Full pill (`rounded-full`), `#2DD4BF` background, `#0B0C0E` text in semi-bold weight. Hover: subtle brightness increase (`#5EEAD4`). Focus: 2px offset ring in `#2DD4BF`.
- **Secondary:** Full pill, `#1C1E22` background, 1px border `#26282D`, `#F2F3F5` text. Hover: border shifts to `#3E4249`.
- **Ghost:** Full pill, transparent background, `#9AA0A9` text. Hover: `#141518` fill with `#F2F3F5` text.
- **Icons:** 16px to 18px stroke icons with 1.5px to 1.75px stroke width (Lucide style), placed with an 8px gap.

### Chips & Badges
- **Status/Feature Badges:** Fully rounded pills with `#141518` background, 1px border `#26282D`, `#9AA0A9` text, `12px` font size.
- **Accent Citation Number:** Compact circular pill (`20px x 20px` or dynamic pill), `#2DD4BF` background with `#0B0C0E` numerical text to flag instructional footnotes and prompt generation references.

### Cards & Curriculum Modules
- **Container:** `#141518` surface with a uniform `1px solid #26282D` border and `24px` rounded corners.
- **Content Padding:** Generous `2rem` (32px) internal padding.
- **Header Structure:** Optional top hairline divider `#26282D` separating module titles from interactive playground previews.

### Input Fields & Prompt Inputs
- **Base Style:** `#141518` background, 1px `#26282D` border, `10px` border-radius, `#F2F3F5` text, `#9AA0A9` placeholder.
- **Active / Focused:** Border cleanly shifts to `#2DD4BF` with no diffuse outer glow.
- **Code Block Inputs:** JetBrains Mono typography, `#0E0F12` background, 1px `#26282D` border, integrated copy-to-clipboard action in the top-right corner.

### Checkboxes & Radio Buttons
- **Checkboxes:** 18px square with 4px border-radius, 1px `#26282D` border on `#141518`. Selected: `#2DD4BF` fill with `#0B0C0E` crisp checkmark.
- **Radio Buttons:** 18px circular frame with 1px `#26282D` border. Selected: `#0B0C0E` interior with `#2DD4BF` centered dot.

### Lists & Syllabus Trees
- **Structure:** Connected with subtle 1px vertical tree guidelines in `#26282D`.
- **Item State:** Horizontal items separated by clean hairline borders, featuring Lucide line icons aligned to the top-left of instructional modules.