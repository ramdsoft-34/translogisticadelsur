import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Globales } from './shared/globales';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Globales],
  template: '<router-outlet /><app-globales />',
})
export class App {}
