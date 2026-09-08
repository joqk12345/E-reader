/** @type {import('tailwindcss').Config} */
// Preserve default scales and name application-specific extensions.
export default {
  "content": [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  "theme": {
    "extend": {
      "colors": {
        "surface": "rgb(var(--color-surface) / <alpha-value>)",
        "surface-subtle": "rgb(var(--color-surface-subtle) / <alpha-value>)",
        "surface-hover": "rgb(var(--color-surface-hover) / <alpha-value>)",
        "foreground": "rgb(var(--color-foreground) / <alpha-value>)",
        "heading": "rgb(var(--color-heading) / <alpha-value>)",
        "muted": "rgb(var(--color-muted) / <alpha-value>)",
        "secondary": "rgb(var(--color-secondary) / <alpha-value>)",
        "navigation": "rgb(var(--color-navigation) / <alpha-value>)",
        "faint": "rgb(var(--color-faint) / <alpha-value>)",
        "border": "rgb(var(--color-border) / <alpha-value>)",
        "control-border": "rgb(var(--color-control-border) / <alpha-value>)",
        "action": "rgb(var(--color-action) / <alpha-value>)",
        "action-text": "rgb(var(--color-action-text) / <alpha-value>)",
        "action-subtle": "rgb(var(--color-action-subtle) / <alpha-value>)",
        "focus": "rgb(var(--color-focus) / <alpha-value>)",
        "focus-border": "rgb(var(--color-focus-border) / <alpha-value>)",
        "success": "rgb(var(--color-success) / <alpha-value>)",
        "success-indicator": "rgb(var(--color-success-indicator) / <alpha-value>)",
        "warning": "rgb(var(--color-warning) / <alpha-value>)",
        "warning-subtle": "rgb(var(--color-warning-subtle) / <alpha-value>)",
        "danger": "rgb(var(--color-danger) / <alpha-value>)",
        "danger-subtle": "rgb(var(--color-danger-subtle) / <alpha-value>)",
        "on-action": "rgb(var(--color-on-action) / <alpha-value>)"
      },
      "accentColor": {
        "action": "rgb(var(--color-action) / <alpha-value>)"
      },
      "fontSize": {
        "caption": "var(--font-size-caption)",
        "control": "var(--font-size-control)",
        "label": "var(--font-size-label)",
        "size-micro": "var(--font-size-micro)",
        "size-meta": "var(--font-size-meta)",
        "size-title": "var(--font-size-title)",
        "size-subheading": "var(--font-size-subheading)",
        "size-brand": "var(--font-size-brand)",
        "size-heading": "var(--font-size-heading)",
        "size-display": "var(--font-size-display)",
        "size-hero": "var(--font-size-hero)",
        "size-reading-sm": "var(--font-size-reading-sm)",
        "size-reading-md": "var(--font-size-reading-md)"
      },
      "spacing": {
        "switch-thumb": "1.125rem",
        "switch-travel": "1.375rem"
      },
      "opacity": {
        "55": "0.55"
      },
      "borderRadius": {
        "panel": "var(--radius-panel)"
      },
      "boxShadow": {
        "panel": "var(--shadow-panel)"
      },
      "gridTemplateColumns": {
        "setting-row": "minmax(0, 1fr) var(--settings-control-width)"
      }
    }
  },
  "plugins": []
};
