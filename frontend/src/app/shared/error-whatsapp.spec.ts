import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ErrorWhatsapp } from './error-whatsapp';
import { Api } from '../core/api.service';
import { nombreTercero } from '../core/modelos';

const diag = (extra: any = {}) => ({
  envio: { _id: 'e1', estado: 'error', error: 'El conductor no ha autorizado…', causa: 'sin_autorizacion', tipo: 'manifiesto', documento: 'M10063406', telefono: '', intentos: 1, solucion: null },
  viaje: { _id: 'v1', numero: 1348, placa: 'TDM027' },
  explicacion: { id: 'sin_autorizacion', titulo: 'El conductor no ha autorizado WhatsApp', explicacion: 'Por la ley…', pasos: ['Confirme', 'Marque'], acciones: ['autorizar', 'celular'] },
  conductor: { _id: 't1', nombre: 'HENRY ARMANDO NARVAEZ GALLARDO', documento: 'C 12970603', celular: '3001234567', celularValido: true, whatsappAutorizado: false, whatsappFallo: null },
  resueltosAntes: [{ accion: 'autorizar', veces: 3 }], otrosConError: 0, puedeConfigurar: false, ...extra,
});

// jsdom no implementa los diálogos nativos que usa app-modal
beforeAll(() => {
  const D = HTMLDialogElement.prototype as any;
  D.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});

describe('Ventana de errores de WhatsApp', () => {
  it('explica la causa, exige confirmar la autorización y corrige', async () => {
    const posts: any[] = [];
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Api, useValue: {
      get: async () => diag(),
      post: async (url: string, cuerpo: any) => { posts.push([url, cuerpo]); return diag({ envio: { ...diag().envio, estado: 'enviado', causa: '' } }); },
    } }] });
    const f = TestBed.createComponent(ErrorWhatsapp);
    f.componentRef.setInput('envios', ['e1']);
    f.detectChanges(); await f.whenStable(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const texto = () => el.textContent!.replace(/\s+/g, ' ');
    expect(texto()).toContain('El conductor no ha autorizado WhatsApp');
    expect(texto()).toContain('registrando la autorización del conductor (3 veces)');
    expect(texto()).not.toContain('Configuración');
    const boton = [...el.querySelectorAll('button')].find((b) => /Guardar y reenviar/.test(b.textContent!))!;
    expect(boton.disabled).toBe(true);   // sin marcar la autorización no deja enviar
    f.componentInstance.autorizo.set(true); f.detectChanges();
    await f.componentInstance.corregir(); f.detectChanges();
    expect(posts).toEqual([['/whatsapp/envios/e1/corregir', { celular: '3001234567', autorizado: true }]]);
    expect(texto()).toContain('se envió');
  });

  it('nombre del tercero sin repetir apellidos', () => {
    expect(nombreTercero({ nombres: 'NARVAEZ GALLARDO HENRY ARMANDO', apellido1: 'NARVAEZ', apellido2: 'GALLARDO' })).toBe('HENRY ARMANDO NARVAEZ GALLARDO');
    expect(nombreTercero({ nombres: 'ARTURO ALDEMAR', apellido1: 'NARVAEZ', apellido2: 'CHINGAL' })).toBe('ARTURO ALDEMAR NARVAEZ CHINGAL');
  });
});
