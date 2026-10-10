import { Component, inject, input, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DeployService } from '../../core/deploy.service';
import { DeployState } from '../../core/models';
import { MaterialModule } from '../../shared/material.module';

/** "Deploy to Environment" button with loading / success / error states. */
@Component({
  selector: 'app-deploy-button',
  imports: [MaterialModule],
  templateUrl: './deploy-button.component.html',
  styleUrl: './deploy-button.component.scss',
})
export class DeployButtonComponent {
  private readonly deployer = inject(DeployService);
  private readonly snack = inject(MatSnackBar);

  /** The backend addresses environments by id; the name is only for the label. */
  readonly envId = input.required<string>();
  readonly envName = input.required<string>();
  protected readonly state = signal<DeployState>({ phase: 'idle' });

  deploy(): void {
    // The service emits loading -> success|error; we just mirror it into a signal.
    this.deployer.deploy(this.envId(), this.envName()).subscribe((s) => {
      this.state.set(s);
      if (s.phase !== 'loading') this.snack.open(s.message ?? '', 'OK', { duration: 4000 });
    });
  }
}
