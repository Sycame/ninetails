import { Component, input } from '@angular/core';

let nextId = 0;

/**
 * The app logo: the head of a trident, drawn in the Material Symbols style (24 px grid, rounded 1.8 stroke,
 * outline only) with a little flare: a gradient from the theme's violet to its magenta, a cyan spark and a soft glow.
 * It follows the light/dark toggle through the --neon-* tokens, so it needs no per-theme asset.
 * (The browser-tab icon is the separate file public/favicon.svg, which cannot read CSS tokens.)
 */
@Component({
  selector: 'app-logo',
  template: `
    <svg viewBox="0 0 24 24" fill="none" [attr.width]="size()" [attr.height]="size()" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="4" y1="2" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" style="stop-color: var(--neon-violet)" />
          <stop offset="1" style="stop-color: var(--neon-magenta)" />
        </linearGradient>
      </defs>
      <g [attr.stroke]="'url(#' + gradientId + ')'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5.5V21" />
        <path d="M9.6 8.5 12 5.5l2.4 3" />
        <path d="M5 7.5V10a7 7 0 0 0 14 0V7.5" />
        <path d="M2.8 10.5 5 7.5l2.2 3" />
        <path d="m16.8 10.5 2.2-3 2.2 3" />
      </g>
      <path class="spark" d="M18.6 1.2l.62 1.68 1.68.62-1.68.62-.62 1.68-.62-1.68-1.68-.62 1.68-.62z" />
      <circle class="dot" cx="5.2" cy="3.4" r=".75" />
    </svg>
  `,
  styles: `
    :host { display: inline-flex; line-height: 0; }
    svg { filter: drop-shadow(0 0 3px color-mix(in srgb, var(--neon-magenta) 55%, transparent)); }
    .spark { fill: var(--neon-cyan); }
    .dot { fill: var(--neon-magenta); }
  `,
})
export class LogoComponent {
  /** Width and height in px. */
  readonly size = input(24);
  /** Unique per instance so several logos on one page never share (or lose) a gradient. */
  protected readonly gradientId = `logo-grad-${nextId++}`;
}