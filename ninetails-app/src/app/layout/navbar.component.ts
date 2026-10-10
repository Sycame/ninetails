import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MaterialModule } from '../shared/material.module';

/** Left navigation. routerLinkActive highlights the current tool; add a row here to add a view. */
@Component({
  selector: 'app-navbar',
  imports: [MaterialModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  protected readonly items = [
    { path: '/racks', label: 'Racks', icon: 'dns' },
    { path: '/envs', label: 'Environments', icon: 'layers' },
    { path: '/teams', label: 'Teams', icon: 'groups' },
    { path: '/deployments', label: 'Deployments', icon: 'rocket_launch' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];
}
