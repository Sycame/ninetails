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
  templateUrl: './logo.component.html',
  styleUrl: './logo.component.scss',
})
export class LogoComponent {
  /** Width and height in px. */
  readonly size = input(24);
  /** Unique per instance so several logos on one page never share (or lose) a gradient. */
  protected readonly gradientId = `logo-grad-${nextId++}`;
}
