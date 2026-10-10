import { Component, input } from '@angular/core';
import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { NodeDetailsComponent } from './node-details.component';

/** Route /node/:id - full-page wrapper around the same details component the side panel uses. */
@Component({
  selector: 'app-node-page',
  imports: [NodeDetailsComponent],
  templateUrl: './node-page.component.html',
})
export class NodePageComponent {
  protected readonly location = inject(Location);
  readonly id = input.required<string>();
}
