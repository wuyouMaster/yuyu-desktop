/* eslint-disable @typescript-eslint/no-require-imports */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  corePlugins: {
    // Keep the existing SCSS application stable while new UI code adopts Tailwind incrementally.
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--yuyu-background) / <alpha-value>)',
        canvas: 'hsl(var(--yuyu-canvas) / <alpha-value>)',
        foreground: 'hsl(var(--yuyu-foreground) / <alpha-value>)',
        surface: 'hsl(var(--yuyu-surface) / <alpha-value>)',
        'surface-muted': 'hsl(var(--yuyu-surface-muted) / <alpha-value>)',
        'surface-elevated': 'hsl(var(--yuyu-surface-elevated) / <alpha-value>)',
        border: 'hsl(var(--yuyu-border) / <alpha-value>)',
        'border-subtle': 'hsl(var(--yuyu-border-subtle) / <alpha-value>)',
        primary: 'hsl(var(--yuyu-primary) / <alpha-value>)',
        'primary-hover': 'hsl(var(--yuyu-primary-hover) / <alpha-value>)',
        'primary-foreground': 'hsl(var(--yuyu-primary-foreground) / <alpha-value>)',
        secondary: 'hsl(var(--yuyu-secondary) / <alpha-value>)',
        'secondary-foreground': 'hsl(var(--yuyu-secondary-foreground) / <alpha-value>)',
        muted: 'hsl(var(--yuyu-muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--yuyu-muted-foreground) / <alpha-value>)',
        'subtle-foreground': 'hsl(var(--yuyu-subtle-foreground) / <alpha-value>)',
        accent: 'hsl(var(--yuyu-accent) / <alpha-value>)',
        'accent-foreground': 'hsl(var(--yuyu-accent-foreground) / <alpha-value>)',
        success: 'hsl(var(--yuyu-success) / <alpha-value>)',
        warning: 'hsl(var(--yuyu-warning) / <alpha-value>)',
        destructive: 'hsl(var(--yuyu-destructive) / <alpha-value>)',
        'destructive-foreground': 'hsl(var(--yuyu-destructive-foreground) / <alpha-value>)',
        'disabled-surface': 'hsl(var(--yuyu-disabled-surface) / <alpha-value>)',
        'disabled-foreground': 'hsl(var(--yuyu-disabled-foreground) / <alpha-value>)',
        'disabled-border': 'hsl(var(--yuyu-disabled-border) / <alpha-value>)',
        ring: 'hsl(var(--yuyu-focus-ring) / <alpha-value>)'
      },
      height: {
        'control-compact': 'var(--yuyu-control-height-compact)',
        'control-standard': 'var(--yuyu-control-height-standard)',
        'control-form': 'var(--yuyu-control-height-form)'
      },
      borderRadius: {
        sm: 'var(--yuyu-radius-sm)',
        md: 'var(--yuyu-radius-md)',
        lg: 'var(--yuyu-radius-lg)',
        xl: 'var(--yuyu-radius-xl)'
      },
      boxShadow: {
        surface: 'var(--yuyu-shadow-surface)',
        floating: 'var(--yuyu-shadow-floating)',
        popover: 'var(--yuyu-shadow-popover)',
        dialog: 'var(--yuyu-shadow-dialog)'
      },
      transitionDuration: {
        fast: 'var(--yuyu-motion-fast)',
        normal: 'var(--yuyu-motion-normal)',
        slow: 'var(--yuyu-motion-slow)'
      },
      transitionTimingFunction: {
        'yuyu-standard': 'var(--yuyu-ease-standard)',
        'yuyu-emphasized': 'var(--yuyu-ease-emphasized)'
      },
      zIndex: {
        base: 'var(--yuyu-z-base)',
        dropdown: 'var(--yuyu-z-dropdown)',
        popover: 'var(--yuyu-z-popover)',
        toast: 'var(--yuyu-z-toast)',
        modal: 'var(--yuyu-z-modal)'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
