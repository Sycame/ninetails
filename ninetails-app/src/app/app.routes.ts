import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

/**
 * Public routes (/login, /auth/callback) sit outside the shell.
 * Everything else is a child of ShellComponent and protected by authGuard once, on the parent.
 * Route params / query params reach components as signal inputs (withComponentInputBinding).
 * Components are lazy-loaded so the first bundle stays small.
 */
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  { path: 'auth/callback', loadComponent: () => import('./features/login/callback.component').then((m) => m.CallbackComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'racks' },
      { path: 'racks', loadComponent: () => import('./features/racks/rack-view.component').then((m) => m.RackViewComponent) },
      { path: 'racks/:id', loadComponent: () => import('./features/racks/rack-view.component').then((m) => m.RackViewComponent) },
      { path: 'envs', loadComponent: () => import('./features/envs/env-list.component').then((m) => m.EnvListComponent) },
      { path: 'envs/:id', loadComponent: () => import('./features/envs/env-detail.component').then((m) => m.EnvDetailComponent) },
      { path: 'node/:id', loadComponent: () => import('./features/racks/node-page.component').then((m) => m.NodePageComponent) },
      { path: 'teams', loadComponent: () => import('./features/misc/teams.component').then((m) => m.TeamsComponent) },
      { path: 'deployments', loadComponent: () => import('./features/misc/deployments.component').then((m) => m.DeploymentsComponent) },
      { path: 'settings', loadComponent: () => import('./features/misc/settings.component').then((m) => m.SettingsComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
