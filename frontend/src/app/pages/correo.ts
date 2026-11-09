import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from '../shared/icono';
import { Confirmar } from '../shared/confirmar';
import { Modal } from '../shared/modal';

interface Firma { texto: string; logo: string; enRespuestas: boolean }
interface Estado { configurado: boolean; conectado: boolean; email: string; error: string; nombre: string; firma: Firma }
interface Carpeta { id: string; nombre: string; noLeidos: number; total?: number; color?: string }
interface Vinculo { tipo: 'cliente' | 'manifiesto' | 'placa'; texto: string; cliente?: string; viaje?: string | null; numeroViaje?: number | null }
interface Persona { nombre: string; correo: string }
interface Hilo { id: string; asunto: string; de: Persona; participantes: string[]; mensajes: number; fecha: string; extracto: string; noLeido: boolean; conAdjuntos: boolean; destacado: boolean; vinculos: Vinculo[] }
interface Adjunto { id: string; nombre: string; tipo: string; tamano: number }
interface Mensaje { id: string; de: Persona; para: string; cc: string; asunto: string; fecha: string; texto: string; html: string; adjuntos: Adjunto[]; idMensaje: string; referencias: string }
interface Detalle { id: string; asunto: string; mensajes: Mensaje[]; vinculos: Vinculo[]; cliente: string | null }
interface Pestana { id: string; nombre: string; noLeidos?: number }
interface DocViaje { viaje: string; numero: number; placa: string; fecha: string; destino: string; documentos: { tipo: 'manifiesto' | 'remesa'; texto: string }[] }
interface Archivo { nombre: string; tipo: string; datos: string; tamano: number }

// Fechas como Gmail: hoy la hora, este año «9 nov», antes «9/11/25»
const fecha = (iso: string) => {
  const f = new Date(iso); const hoy = new Date();
  if (f.toDateString() === hoy.toDateString()) return f.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  if (f.getFullYear() === hoy.getFullYear()) return f.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ');
  return f.toLocaleDateString('es-CO', { day: 'numeric', month: 'numeric', year: '2-digit' });
};
const fechaLarga = (iso: string) => {
  const f = new Date(iso); const min = Math.round((Date.now() - f.getTime()) / 60000);
  const hace = min < 60 ? `hace ${Math.max(1, min)} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : '';
  return `${f.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')}, ${f.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}${hace ? ` (${hace})` : ''}`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// Texto de un correo que solo trae HTML (para citarlo al responder), respetando los saltos de línea
const textoDe = (html = '') => new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '$&\n'), 'text/html').body.textContent?.replace(/\n{3,}/g, '\n\n').trim() || '';
const CHIP: Record<string, string> = { cliente: 'ch-c', manifiesto: 'ch-m', placa: 'ch-p' };
const COLORES = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83', '#c5221f', '#5f6368'];
const PUBLICOS = ['gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'msn.com'];
const VER: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// Íconos tipo Material (los de Gmail), 24×24
const IC: Record<string, string> = {
  INBOX: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10z',
  STARRED: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  estrella: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  SNOOZED: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  IMPORTANT: 'M15 19H3l4.5-7L3 5h12c.65 0 1.26.31 1.63.84L21 12l-4.37 6.16c-.37.52-.98.84-1.63.84zm-8.5-2H15l3.5-5L15 7H6.5l3.5 5-3.5 5z',
  SENT: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  DRAFT: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z',
  SPAM: 'M15.73 3H8.27L3 8.27v7.46L8.27 21h7.46L21 15.73V8.27L15.73 3zM19 14.9L14.9 19H9.1L5 14.9V9.1L9.1 5h5.8L19 9.1v5.8zM11 7h2v6h-2zm0 8h2v2h-2z',
  TRASH: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  etiqueta: 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z',
  lapiz: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  clip: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  formato: 'M5 17v2h14v-2H5zm4.5-4.2h5l.9 2.2h2.1L12.75 4h-1.5L6.5 15h2.1l.9-2.2zM12 5.98L13.87 11h-3.74L12 5.98z',
  responder: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  todos: 'M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  reenviar: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  vinetas: 'M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z',
  numeros: 'M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z',
  enlace: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  limpiar: 'M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z',
  recargar: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  atras: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  izq: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z', der: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  doc: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  bajar: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', edificio: 'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z', ojo: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};

// Fase 14: el Gmail de cada usuario dentro de la plataforma, con el aspecto y los pasos de Gmail: carpetas, búsqueda,
// chips de filtro, conversación a lo ancho, adjuntos en tarjetas y la ventana «Mensaje nuevo» con De, Cc/Cco, formato y firma.
// Lo propio de la plataforma: los correos se unen solos a placas, manifiestos y clientes, y se adjuntan manifiestos y remesas.
@Component({
  selector: 'app-correo',
  imports: [FormsModule, Icono, Confirmar, Modal],
  template: `
    @if (!estado()) { <p class="sutil">Cargando…</p> }
    @else if (!estado()!.configurado) {
      <div class="pagina-cab"><div><h1>Correo</h1></div></div>
      <div class="tarjeta vacio"><h2>Falta configurar Google en el servidor</h2>
        <p>El administrador de la plataforma debe crear el acceso de Google (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET). Los pasos están en docs/CORREO_GMAIL.md.</p></div>
    } @else if (!estado()!.conectado) {
      <div class="pagina-cab"><div><h1>Correo</h1></div></div>
      <div class="tarjeta vacio">
        <app-icono nombre="correo" [tam]="40" />
        <h2>Conecte su Gmail</h2>
        <p>Google le pedirá autorizar a la plataforma para leer y enviar correo. Su contraseña no pasa por aquí y puede quitar el permiso cuando quiera.</p>
        @if (estado()!.error) { <div class="mensaje alerta" role="status">Google retiró el permiso anterior. Conéctelo de nuevo.</div> }
        <button type="button" class="primario" (click)="conectar()" [disabled]="trabajando()">Conectar con Google</button>
      </div>
    } @else {
      <div class="gm" [class.cajon]="verCajon()">
        <!-- Barra superior: menú, búsqueda grande y cuenta -->
        <div class="barra">
          <button type="button" class="ic menu-b" (click)="verCajon.set(!verCajon())" aria-label="Menú"><svg viewBox="0 0 24 24"><path [attr.d]="IC['menu']" /></svg></button>
          <span class="logo"><span class="g"></span>Correo</span>
          <form class="buscar" (ngSubmit)="buscar()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            <input type="search" name="q" [(ngModel)]="q" placeholder="Buscar correo: cliente, placa, manifiesto…" aria-label="Buscar en el correo" />
          </form>
          <button type="button" class="ic" (click)="abrirFirma()" title="Firma y nombre del remitente" aria-label="Configuración"><app-icono nombre="ajustes" [tam]="20" /></button>
          <span class="cuenta" [title]="estado()!.email + ' · solo usted ve este buzón'"><span class="av" [style.background]="color(estado()!.nombre || estado()!.email)">{{ inicial(estado()!.nombre || estado()!.email) }}</span><span class="c-txt">{{ estado()!.email }}</span></span>
        </div>

        <div class="cuerpo-gm">
          <!-- Carpetas -->
          <nav class="carpetas" aria-label="Carpetas">
            <button type="button" class="redactar" (click)="redactar()"><svg viewBox="0 0 24 24"><path [attr.d]="IC['lapiz']" /></svg>Redactar</button>
            @for (c of carpetasVisibles(); track c.id) {
              <button type="button" class="carpeta" [class.activa]="etiqueta() === c.id && !cliente()" [class.nl]="c.id === 'INBOX' && c.noLeidos" (click)="abrirCarpeta(c.id)">
                <svg viewBox="0 0 24 24"><path [attr.d]="IC[c.id] || IC['etiqueta']" /></svg><span class="n">{{ c.nombre }}</span>
                @if (c.id === 'DRAFT' ? c.total : c.noLeidos) { <b>{{ c.id === 'DRAFT' ? c.total : c.noLeidos }}</b> }</button>
            }
            <button type="button" class="carpeta" (click)="verMas.set(!verMas())"><svg viewBox="0 0 24 24" [style.transform]="verMas() ? 'rotate(180deg)' : ''"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" /></svg><span class="n">{{ verMas() ? 'Menos' : 'Más' }}</span></button>
            @if (principales().length) {
              <p class="titulo">Clientes</p>
              @for (t of clientesVisibles(); track t.id) {
                <button type="button" class="carpeta" [class.activa]="cliente() === t.id" [class.nl]="!!t.noLeidos" (click)="abrirCliente(t.id)" [title]="'Todo lo de ' + t.nombre">
                  <svg viewBox="0 0 24 24" [style.fill]="color(t.nombre)"><path [attr.d]="IC['etiqueta']" /></svg><span class="n">{{ t.nombre }}</span>@if (t.noLeidos) { <b>{{ t.noLeidos }}{{ t.noLeidos >= 50 ? '+' : '' }}</b> }</button>
              }
              @if (otros().length) { <button type="button" class="carpeta" (click)="verMasClientes.set(!verMasClientes())"><svg viewBox="0 0 24 24" [style.transform]="verMasClientes() ? 'rotate(180deg)' : ''"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" /></svg><span class="n">{{ verMasClientes() ? 'Menos' : 'Más clientes (' + otros().length + ')' }}</span></button> }
            }
            @if (propias().length) { <p class="titulo">Etiquetas</p>
              @for (c of propias(); track c.id) {
                <button type="button" class="carpeta" [class.activa]="etiqueta() === c.id && !cliente()" (click)="abrirCarpeta(c.id)"><svg viewBox="0 0 24 24" [style.fill]="c.color || '#5f6368'"><path [attr.d]="IC['etiqueta']" /></svg><span class="n">{{ c.nombre }}</span>@if (c.noLeidos) { <b>{{ c.noLeidos }}</b> }</button>
              } }
            <button type="button" class="desconectar" confirmar="Clic otra vez: se quita el permiso de Gmail" (confirmado)="desconectar()">Desconectar Gmail</button>
          </nav>
          <div class="velo-c" (click)="verCajon.set(false)"></div>

          <main class="principal">
            @if (!detalle() && !hiloSel()) {
              <!-- Lista -->
              <div class="herr">
                <button type="button" class="ic" (click)="cargarHilos()" title="Actualizar" aria-label="Actualizar"><svg viewBox="0 0 24 24"><path [attr.d]="IC['recargar']" /></svg></button>
                <span class="rango">{{ rango() }}</span>
                <button type="button" class="ic" [disabled]="!paginas().length" (click)="paginaAnterior()" aria-label="Más recientes"><svg viewBox="0 0 24 24"><path [attr.d]="IC['izq']" /></svg></button>
                <button type="button" class="ic" [disabled]="!siguiente()" (click)="paginaSiguiente()" aria-label="Más antiguos"><svg viewBox="0 0 24 24"><path [attr.d]="IC['der']" /></svg></button>
              </div>
              <div class="chips-f">
                <label class="chip-f" [class.on]="fechaF()"><select [ngModel]="fechaF()" (ngModelChange)="fechaF.set($event); cargarHilos()" aria-label="Fecha">
                  @for (o of FECHAS; track o[0]) { <option [value]="o[0]">{{ o[1] }}</option> }</select></label>
                <button type="button" class="chip-f" [class.on]="chips().has('adjuntos')" (click)="chip('adjuntos')"><svg viewBox="0 0 24 24"><path [attr.d]="IC['clip']" /></svg>Contiene archivos adjuntos</button>
                <button type="button" class="chip-f" [class.on]="chips().has('no_leidos')" (click)="chip('no_leidos')">No leídos</button>
                @if (q.trim()) { <button type="button" class="chip-f on" (click)="q = ''; cargarHilos()">«{{ q.trim() }}» ✕</button> }
              </div>
              @if (cliente()) { <p class="nota-p"><svg viewBox="0 0 24 24" [style.color]="color(nombreCliente(cliente()))"><path [attr.d]="IC['etiqueta']" /></svg><span>Etiqueta <b>{{ nombreCliente(cliente()) }}</b>: todo lo del cliente, recibido y enviado (sus correos, lo que lo nombra y sus placas del último mes).</span></p> }
              @if (cargandoLista()) { <div class="cargando"></div> }
              <div class="filas">
                @for (h of hilos(); track h.id) {
                  <div class="hilo" role="link" tabindex="0" [class.nl]="h.noLeido" (click)="abrir(h)" (keydown.enter)="abrir(h)">
                    <button type="button" class="estrella" [class.on]="h.destacado" (click)="$event.stopPropagation(); destacar(h)" [attr.aria-label]="h.destacado ? 'Quitar destacado' : 'Destacar'">
                      <svg viewBox="0 0 24 24"><path [attr.d]="h.destacado ? IC['estrella'] : IC['STARRED']" /></svg></button>
                    <span class="av-m" [style.background]="color(h.de.nombre)">{{ inicial(h.de.nombre) }}</span>
                    <span class="de">{{ remitentes(h) }}@if (h.mensajes > 1) { <small>{{ h.mensajes }}</small> }</span>
                    <span class="txt"><span class="as">{{ h.asunto || '(sin asunto)' }}</span><span class="pr"><span class="guion"> - </span>{{ h.extracto }}</span></span>
                    <span class="chips">@for (v of h.vinculos.slice(0, 2); track $index) { @if (v.tipo === 'cliente') { <span class="et-c" [style.background]="color(v.texto.replace('Cliente: ', ''))" (click)="chipCliente($event, v)" [title]="'Etiqueta del cliente: ' + v.texto.replace('Cliente: ', '')">{{ v.texto.replace('Cliente: ', '') }}</span> } @else { <span [class]="'chip-v ' + CHIP[v.tipo]">{{ v.texto }}</span> } }</span>
                    <span class="h">@if (h.conAdjuntos) { <svg class="clip" viewBox="0 0 24 24" aria-label="Con adjuntos"><path [attr.d]="IC['clip']" /></svg> }{{ fecha(h.fecha) }}</span>
                  </div>
                } @empty { @if (!cargandoLista()) { <p class="vacia">No hay conversaciones{{ q.trim() || chips().size || fechaF() ? ' con este filtro' : ' en ' + nombreCarpeta() }}.</p> } }
              </div>
            } @else {
              <!-- Conversación a lo ancho, como Gmail -->
              <div class="herr">
                <button type="button" class="ic" (click)="volver()" title="Volver" aria-label="Volver a la lista"><svg viewBox="0 0 24 24"><path [attr.d]="IC['atras']" /></svg></button>
                @if (hiloSel(); as h) {
                  <button type="button" class="ic" confirmar="Clic otra vez: a la papelera" (confirmado)="papelera(h)" title="Eliminar" aria-label="Mover a la papelera"><svg viewBox="0 0 24 24"><path [attr.d]="IC['TRASH']" /></svg></button>
                  <button type="button" class="ic estrella" [class.on]="h.destacado" (click)="destacar(h)" [title]="h.destacado ? 'Quitar destacado' : 'Destacar'"><svg viewBox="0 0 24 24"><path [attr.d]="h.destacado ? IC['estrella'] : IC['STARRED']" /></svg></button>
                }
              </div>
              @if (detalle(); as d) {
                <div class="hilo-v">
                  <h2>{{ d.asunto || '(sin asunto)' }} <span class="et">{{ nombreCarpeta() }}</span>@if (d.cliente) { <span class="et-c grande" [style.background]="color(nombreCliente(d.cliente))">{{ nombreCliente(d.cliente) }}<button type="button" (click)="mover(d, '')" title="Quitar la etiqueta" aria-label="Quitar la etiqueta del cliente">×</button></span> }</h2>
                  @if (d.vinculos.length) {
                    <div class="vinc"><b>Vinculado a</b>@for (v of d.vinculos; track $index) {
                      <button type="button" [class]="'chip-v ' + CHIP[v.tipo]" (click)="buscarTexto(v.tipo === 'cliente' ? v.texto.replace('Cliente: ', '') : v.texto.replace('Manifiesto ', ''))" title="Ver los correos de esto">{{ v.texto }}@if (v.numeroViaje) { · viaje {{ v.numeroViaje }} }</button> }
                      <span class="nota">Reconocido por la placa, el número de manifiesto y el cliente.</span></div>
                  }
                  <div class="mover"><svg viewBox="0 0 24 24"><path [attr.d]="IC['etiqueta']" /></svg><span>Etiqueta del cliente</span>
                    <select [ngModel]="d.cliente || ''" (ngModelChange)="mover(d, $event)" aria-label="Etiqueta del cliente">
                      <option value="">Sin cliente</option>@for (o of todosClientes(); track o.id) { <option [value]="o.id">{{ o.nombre }}</option> }</select>
                    @if (dominioDe(d); as dom) { <label class="chk-m"><input type="checkbox" [(ngModel)]="todoDominio" /> todos los de &#64;{{ dom }}</label> }
                    <small>Los próximos correos de {{ todoDominio && dominioDe(d) ? 'todo @' + dominioDe(d) : remitenteDe(d) }} quedarán con esa etiqueta.</small></div>
                  @for (m of d.mensajes; track m.id; let ultimo = $last) {
                    <article class="msg" [class.abierto]="ultimo || abiertos().has(m.id)">
                      <header (click)="!ultimo && alternar(m.id)">
                        <span class="av" [style.background]="color(m.de.nombre)">{{ inicial(m.de.nombre) }}</span>
                        <span class="quien"><b>{{ m.de.nombre }}</b>&nbsp;<small>&lt;{{ m.de.correo }}&gt;</small>
                          @if (ultimo || abiertos().has(m.id)) { <small class="d">para {{ paraCorto(m) }}</small> } @else { <small class="d">{{ m.texto.slice(0, 120) }}</small> }</span>
                        <span class="h">{{ fechaLarga(m.fecha) }}</span>
                        @if (ultimo || abiertos().has(m.id)) { <button type="button" class="ic" (click)="$event.stopPropagation(); responder(d)" title="Responder" aria-label="Responder"><svg viewBox="0 0 24 24"><path [attr.d]="IC['responder']" /></svg></button> }
                      </header>
                      @if (ultimo || abiertos().has(m.id)) {
                        @if (m.html) { <iframe class="cuerpo" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" [srcdoc]="html(m.html)" (load)="ajustar($event)" title="Contenido del correo"></iframe> }
                        @else { <pre class="texto">{{ m.texto }}</pre> }
                        @if (m.adjuntos.length) {
                          <div class="adj-t">{{ m.adjuntos.length === 1 ? 'Un archivo adjunto' : m.adjuntos.length + ' archivos adjuntos' }}</div>
                          <div class="tarjetas">@for (a of m.adjuntos; track a.id) {
                            <div class="t-adj" [title]="a.nombre">
                              <div class="prev">@if (miniaturas()[a.id]; as src) { <img [src]="src" alt="" /> } @else { <span [class]="'tipo-g ' + claseTipo(a.nombre)">{{ ext(a.nombre) }}</span> }
                                <div class="sobre">@if (sePuedeVer(a.nombre)) { <button type="button" (click)="ver(m.id, a)" title="Ver" aria-label="Ver"><svg viewBox="0 0 24 24"><path [attr.d]="IC['ojo']" /></svg></button> }
                                  <button type="button" (click)="bajar(m.id, a)" title="Descargar" aria-label="Descargar"><svg viewBox="0 0 24 24"><path [attr.d]="IC['bajar']" /></svg></button></div></div>
                              <div class="pie-adj"><span [class]="'mini ' + claseTipo(a.nombre)">{{ ext(a.nombre) }}</span><span class="nom">{{ a.nombre }}</span></div>
                            </div> }</div>
                        }
                      }
                    </article>
                  }
                  <div class="resp">
                    <button type="button" class="pill" (click)="responder(d)"><svg viewBox="0 0 24 24"><path [attr.d]="IC['responder']" /></svg>Responder</button>
                    <button type="button" class="pill" (click)="responder(d, true)"><svg viewBox="0 0 24 24"><path [attr.d]="IC['todos']" /></svg>Responder a todos</button>
                    <button type="button" class="pill" (click)="reenviar(d)"><svg viewBox="0 0 24 24"><path [attr.d]="IC['reenviar']" /></svg>Reenviar</button>
                  </div>
                </div>
              } @else { <div class="cargando"></div> }
            }
          </main>
        </div>
        <button type="button" class="fab" (click)="redactar()"><svg viewBox="0 0 24 24"><path [attr.d]="IC['lapiz']" /></svg>Redactar</button>
      </div>
    }

    <!-- Ventana «Mensaje nuevo», abajo a la derecha como en Gmail -->
    @if (componiendo()) {
      <section class="ventana" [class.min]="minimizado()" [class.max]="maximizado()" role="dialog" [attr.aria-label]="tituloVentana()">
        <header (click)="minimizado() && minimizado.set(false)">
          <span>{{ tituloVentana() }}</span>
          <span class="botones-v">
            <button type="button" (click)="$event.stopPropagation(); minimizado.set(!minimizado())" [attr.aria-label]="minimizado() ? 'Abrir' : 'Minimizar'" title="Minimizar">{{ minimizado() ? '▴' : '–' }}</button>
            <button type="button" (click)="$event.stopPropagation(); maximizado.set(!maximizado()); minimizado.set(false)" aria-label="Pantalla completa" title="Pantalla completa">⤢</button>
            <button type="button" (click)="$event.stopPropagation(); cerrarComposicion()" aria-label="Cerrar" title="Guardar y cerrar">✕</button>
          </span>
        </header>
        <div class="campos" [hidden]="minimizado()">
          <div class="linea de-l"><span>De</span><span class="de-v">{{ remitenteVisible() }}</span></div>
          <label class="linea"><span>Para</span><input [(ngModel)]="resp.para" placeholder="Destinatarios" />
            <span class="cc-l">@if (!verCc()) { <button type="button" class="enlace" (click)="verCc.set(true)">Cc</button> }@if (!verCco()) { <button type="button" class="enlace" (click)="verCco.set(true)">Cco</button> }</span></label>
          @if (verCc()) { <label class="linea"><span>Cc</span><input [(ngModel)]="resp.cc" /></label> }
          @if (verCco()) { <label class="linea"><span>Cco</span><input [(ngModel)]="resp.cco" title="Copia oculta: los demás no la ven" /></label> }
          <label class="linea"><input [(ngModel)]="resp.asunto" maxlength="250" placeholder="Asunto" aria-label="Asunto" /></label>
          <div #editor class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Cuerpo del mensaje" (paste)="pegar($event)" (keydown.control.enter)="enviar()" (keydown.meta.enter)="enviar()"></div>
          <div class="adjuntar" [hidden]="!verDocs() && !adjuntos().length && !documentos().length">
            @if (verDocs()) {
              <div class="docs">
                <form (ngSubmit)="buscarDocs()" class="fila"><input name="qd" [(ngModel)]="qDocs" placeholder="Placa, número de viaje o manifiesto" aria-label="Buscar viaje" /><button type="submit" class="pequeno">Buscar</button></form>
                @for (v of docs(); track v.viaje) {
                  <div class="doc"><span><b>Viaje {{ v.numero }}</b> · {{ v.placa }} · {{ v.destino }}</span>
                    @for (x of v.documentos; track x.tipo) { <label><input type="checkbox" [checked]="tieneDoc(v.viaje, x.tipo)" (change)="alternarDoc(v.viaje, x.tipo, x.texto)" /> {{ x.texto }}</label> }
                    @if (!v.documentos.length) { <small class="sutil">Sin manifiesto ni remesa expedidos</small> }</div>
                } @empty { <p class="sutil">Busque el viaje para adjuntar su manifiesto o su remesa (el PDF se genera al enviar).</p> }
              </div>
            }
            @if (adjuntos().length || documentos().length) {
              <div class="adjs">
                @for (a of adjuntos(); track $index) { <span class="adj"><span [class]="'mini ' + claseTipo(a.nombre)">{{ ext(a.nombre) }}</span><span class="nom">{{ a.nombre }}</span> <small>({{ kb(a.tamano) }})</small><button type="button" class="x" (click)="quitarArchivo($index)" aria-label="Quitar">×</button></span> }
                @for (d of documentos(); track $index) { <span class="adj"><span class="mini t-pdf">PDF</span><span class="nom">{{ d.texto }}</span><button type="button" class="x" (click)="quitarDoc($index)" aria-label="Quitar">×</button></span> }
              </div>
            }
          </div>
        </div>
        @if (!minimizado()) {
          @if (verFormato()) {
            <div class="formato" (mousedown)="$event.preventDefault()">
              <button type="button" (click)="fmt('bold')" title="Negrita (Ctrl+B)"><b>B</b></button>
              <button type="button" (click)="fmt('italic')" title="Cursiva (Ctrl+I)"><i>I</i></button>
              <button type="button" (click)="fmt('underline')" title="Subrayado (Ctrl+U)"><u>U</u></button>
              <label class="color-b" title="Color del texto"><span>A</span><input type="color" (input)="color2($event)" /></label>
              <i class="sep"></i>
              <button type="button" (click)="fmt('insertOrderedList')" title="Lista numerada"><svg viewBox="0 0 24 24"><path [attr.d]="IC['numeros']" /></svg></button>
              <button type="button" (click)="fmt('insertUnorderedList')" title="Lista con viñetas"><svg viewBox="0 0 24 24"><path [attr.d]="IC['vinetas']" /></svg></button>
              <button type="button" (click)="pedirEnlace()" title="Insertar vínculo"><svg viewBox="0 0 24 24"><path [attr.d]="IC['enlace']" /></svg></button>
              <i class="sep"></i>
              <button type="button" (click)="fmt('removeFormat')" title="Quitar formato"><svg viewBox="0 0 24 24"><path [attr.d]="IC['limpiar']" /></svg></button>
              @if (verEnlace()) { <span class="enl" (mousedown)="$event.stopPropagation()"><input [(ngModel)]="url" placeholder="https://…" aria-label="Dirección del vínculo" (keydown.enter)="ponerEnlace()" /><button type="button" class="pequeno" (click)="ponerEnlace()">Aplicar</button></span> }
            </div>
          }
          <footer>
            <span class="enviar-g"><button type="button" class="enviar" (click)="enviar()" [disabled]="trabajando()" title="Enviar (Ctrl+Intro)">{{ trabajando() ? 'Enviando…' : 'Enviar' }}</button></span>
            <button type="button" class="icono-v" [class.on]="verFormato()" (click)="verFormato.set(!verFormato())" title="Opciones de formato"><svg viewBox="0 0 24 24"><path [attr.d]="IC['formato']" /></svg></button>
            <label class="icono-v" title="Adjuntar archivos"><input type="file" multiple (change)="archivos($event)" /><svg viewBox="0 0 24 24"><path [attr.d]="IC['clip']" /></svg></label>
            <button type="button" class="icono-v" (click)="ponerFirma()" title="Insertar firma"><svg viewBox="0 0 24 24"><path [attr.d]="IC['lapiz']" /></svg></button>
            <button type="button" class="icono-v texto-v" [class.on]="verDocs()" (click)="verDocs.set(!verDocs())" title="Manifiesto o remesa de un viaje"><svg viewBox="0 0 24 24"><path [attr.d]="IC['doc']" /></svg>Documentos del viaje</button>
            <button type="button" class="icono-v descartar" confirmar="Clic otra vez para descartar" (confirmado)="descartar()" title="Descartar borrador"><svg viewBox="0 0 24 24"><path [attr.d]="IC['TRASH']" /></svg></button>
          </footer>
        }
      </section>
    }

    <!-- Vista previa de un adjunto (PDF o imagen) sin descargarlo -->
    @if (visor(); as v) {
      <div class="visor" (click)="cerrarVisor()">
        <header (click)="$event.stopPropagation()"><span>{{ v.nombre }}</span>
          <button type="button" class="ic claro" (click)="bajar(v.mensaje, v.adj)" title="Descargar"><svg viewBox="0 0 24 24"><path [attr.d]="IC['bajar']" /></svg></button>
          <button type="button" class="ic claro" (click)="cerrarVisor()" aria-label="Cerrar">✕</button></header>
        <div class="v-cuerpo" (click)="$event.stopPropagation()">@if (v.pdf) { <iframe [src]="v.url" title="Vista previa"></iframe> } @else { <img [src]="v.url" alt="" /> }</div>
      </div>
    }

    <app-modal titulo="Firma y remitente" [abierto]="editandoFirma()" (cerrar)="editandoFirma.set(false)">
      <div class="firma-f">
        <label>Nombre que ven los destinatarios en «De»<input [(ngModel)]="fNombre" maxlength="80" placeholder="Cristian Salcedo" /></label>
        <label>Firma<textarea [(ngModel)]="fTexto" rows="5" maxlength="1500" placeholder="Cristian Salcedo&#10;Gerente Logístico&#10;Tel 315 378 3124"></textarea></label>
        <div class="logo-f"><span>Logo (PNG o JPG)</span>
          @if (fLogo) { <img [src]="fLogo" alt="Logo de la firma" /><button type="button" class="pequeno" (click)="fLogo = ''">Quitar</button> }
          <label class="pequeno boton-archivo"><input type="file" accept="image/png,image/jpeg" (change)="cargarLogo($event)" />{{ fLogo ? 'Cambiar' : 'Subir logo' }}</label></div>
        <label class="chk"><input type="checkbox" [(ngModel)]="fEnRespuestas" /> Poner la firma también al responder y reenviar</label>
        <div class="vista-firma"><small>Así se ve</small><div class="gs">--<br>@if (fLogo) { <img [src]="fLogo" alt="" /><br> }<span class="pre">{{ fTexto }}</span></div></div>
      </div>
      <div pie><button type="button" (click)="editandoFirma.set(false)">Cancelar</button><button type="button" class="primario" (click)="guardarFirma()" [disabled]="trabajando()">Guardar</button></div>
    </app-modal>
  `,
  styles: [`
    :host { --g-sel: var(--azul-claro); --g-azul: #0b57d0; --g-borde: var(--gris-2); --g-tenue: var(--gris-5); display: block; }
    :host-context([data-tema="oscuro"]) { --g-azul: #a8c7fa; }
    svg { width: 20px; height: 20px; fill: currentColor; flex: none; }
    .vacio { max-width: 560px; margin: 40px auto; text-align: center; display: flex; flex-direction: column; gap: 10px; align-items: center; }
    .ic { width: 38px; height: 38px; min-height: 0; padding: 0; border-radius: 50%; border: 0; background: none; box-shadow: none; color: var(--gris-6); display: inline-grid; place-items: center; flex: none; }
    .ic:hover:not(:disabled) { background: var(--gris-15); } .ic:disabled { opacity: .35; } .ic.claro { color: #fff; } .ic.claro:hover { background: rgba(255,255,255,.14); }
    .gm { border-radius: var(--radio-l); background: var(--fondo); position: relative; }
    .barra { display: flex; align-items: center; gap: 8px; padding: 6px 4px 10px; }
    .logo { display: flex; align-items: center; gap: 10px; font-size: 21px; font-weight: 500; color: var(--gris-6); width: 182px; flex: none; }
    .g { width: 26px; height: 26px; border-radius: 6px; background: conic-gradient(#ea4335 0 25%, #fbbc05 0 50%, #34a853 0 75%, #4285f4 0); flex: none; }
    .menu-b { display: none; }
    .buscar { flex: 1; max-width: 720px; display: flex; align-items: center; gap: 10px; background: var(--gris-15); border-radius: 999px; padding: 0 16px; height: 46px; }
    .buscar:focus-within { background: var(--campo); box-shadow: 0 1px 3px rgba(32,33,36,.28); } .buscar svg { color: var(--gris-6); }
    .buscar input { flex: 1; border: 0; background: none; box-shadow: none; padding: 0; font-size: 15px; min-width: 0; } .buscar input:focus { outline: none; }
    .cuenta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--gris-6); }
    .av, .av-m { width: 34px; height: 34px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-weight: 600; font-size: 14px; flex: none; }
    .cuerpo-gm { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: 72vh; }
    .carpetas { display: flex; flex-direction: column; gap: 0; padding-right: 12px; }
    .redactar { display: inline-flex; align-items: center; gap: 12px; align-self: flex-start; height: 56px; padding: 0 24px 0 18px; margin: 0 0 14px; border-radius: 16px; border: 0;
      background: var(--g-sel); color: var(--tinta-texto, inherit); font-weight: 600; font-size: 14px; box-shadow: none; color: inherit; }
    .redactar:hover { box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); }
    .carpeta { display: flex; align-items: center; gap: 16px; height: 32px; min-height: 0; padding: 0 12px 0 22px; border: 0; border-radius: 0 16px 16px 0; background: none; box-shadow: none;
      font-weight: 400; font-size: 14px; color: inherit; justify-content: flex-start; text-align: left; width: 100%; }
    .carpeta:hover { background: var(--gris-15); } .carpeta.activa { background: var(--g-sel); font-weight: 700; } .carpeta.nl { font-weight: 700; }
    .carpeta .n { flex: 1; overflow: hidden; text-overflow: ellipsis; } .carpeta b { font-size: 12px; font-weight: 700; } .carpeta svg { color: var(--gris-6); }
    .carpetas .titulo { font-size: 15px; font-weight: 500; margin: 16px 0 4px 22px; }
    .desconectar { margin: 18px 0 0 22px; align-self: flex-start; background: none; border: 0; box-shadow: none; color: var(--g-tenue); font-size: 12.5px; padding: 4px 0; min-height: 0; font-weight: 500; text-decoration: underline; }
    .velo-c { display: none; }
    .principal { background: var(--gris-0); border-radius: 16px; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
    .herr { display: flex; align-items: center; gap: 2px; padding: 6px 10px; } .rango { margin-left: auto; font-size: 12.5px; color: var(--g-tenue); padding: 0 6px; }
    .chips-f { display: flex; gap: 8px; padding: 2px 16px 10px; flex-wrap: wrap; border-bottom: 1px solid var(--gris-15); }
    .chip-f { display: inline-flex; align-items: center; gap: 6px; height: 32px; min-height: 0; padding: 0 14px; border: 1px solid var(--gris-3); border-radius: 8px; background: none; box-shadow: none; font-size: 13.5px; font-weight: 500; color: inherit; }
    .chip-f svg { width: 16px; height: 16px; } .chip-f.on { background: var(--g-sel); border-color: transparent; }
    .chip-f select { border: 0; background: none; box-shadow: none; padding: 0; font: inherit; color: inherit; min-height: 0; height: 30px; cursor: pointer; }
    .cargando { height: 3px; background: linear-gradient(90deg, transparent, var(--g-azul), transparent); background-size: 50% 100%; animation: barra 1s linear infinite; }
    @keyframes barra { from { background-position: -50% 0; } to { background-position: 150% 0; } }
    .filas { flex: 1; overflow-y: auto; }
    .hilo { display: grid; grid-template-columns: 36px 200px minmax(0, 1fr) auto 84px; align-items: center; gap: 0 8px; height: 40px; padding: 0 16px 0 8px; border-bottom: 1px solid var(--gris-15); cursor: pointer; font-size: 14px; background: color-mix(in srgb, var(--gris-15) 55%, var(--gris-0)); }
    .hilo.nl { background: var(--gris-0); font-weight: 700; }
    .hilo:hover { box-shadow: inset 1px 0 0 var(--gris-3), inset -1px 0 0 var(--gris-3), 0 1px 2px 0 rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15); position: relative; z-index: 1; }
    .hilo:focus-visible { outline: 2px solid var(--g-azul); outline-offset: -2px; }
    .av-m { display: none; }
    .estrella { width: 32px; height: 32px; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; border-radius: 50%; display: grid; place-items: center; color: var(--gris-4); }
    .estrella:hover { background: var(--gris-15); } .estrella.on { color: #f4b400; } .estrella svg { width: 20px; height: 20px; }
    .de { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .de small { margin-left: 4px; color: var(--g-tenue); font-weight: 400; font-size: 12px; }
    .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; } .pr { color: var(--g-tenue); font-weight: 400; }
    .hilo .chips { display: flex; gap: 4px; overflow: hidden; }
    .h { font-size: 12.5px; text-align: right; white-space: nowrap; display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
    .hilo:not(.nl) .h { color: var(--g-tenue); font-weight: 400; } .h .clip { width: 16px; height: 16px; color: var(--g-tenue); }
    .chip-v { display: inline-block; font-size: 11.5px; font-weight: 600; border-radius: 4px; padding: 1px 6px; border: 0; min-height: 0; white-space: nowrap; }
    .ch-c { background: var(--ambar-claro); color: var(--ambar); } .ch-m { background: var(--rojo-claro); color: var(--rojo); } .ch-p { background: var(--azul-claro); color: var(--azul); }
    .et-c { display: inline-flex; align-items: center; gap: 4px; color: #fff; font-size: 11.5px; font-weight: 600; border-radius: 4px; padding: 1px 7px; white-space: nowrap; cursor: pointer; }
    .et-c.grande { font-size: 12px; padding: 2px 4px 2px 8px; vertical-align: middle; margin-left: 6px; cursor: default; }
    .et-c button { border: 0; background: none; color: #fff; min-height: 0; padding: 0 4px; font-size: 15px; line-height: 1; box-shadow: none; border-radius: 3px; } .et-c button:hover { background: rgba(0,0,0,.2); }
    .nota-p { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 16px; font-size: 12.5px; color: var(--g-tenue); border-bottom: 1px solid var(--gris-15); }
    .mover { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; margin: -4px 0 14px; color: var(--gris-6); }
    .mover svg { width: 18px; height: 18px; } .mover select { min-height: 0; padding: 4px 8px; font-size: 13px; max-width: 220px; }
    .mover small { color: var(--g-tenue); } .chk-m { display: inline-flex; align-items: center; gap: 4px; }
    .chip-v.ch-c { cursor: pointer; }
    .vacia { padding: 28px 16px; text-align: center; color: var(--g-tenue); }
    .hilo-v { padding: 4px 16px 24px 72px; overflow-y: auto; }
    .hilo-v h2 { font-size: 22px; font-weight: 400; margin: 6px 0 14px; } .et { font-size: 12px; background: var(--gris-15); border-radius: 4px; padding: 2px 6px; vertical-align: middle; color: var(--gris-6); }
    .vinc { border: 1px dashed var(--gris-3); border-radius: 12px; padding: 8px 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .vinc > b { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gris-6); } .vinc button { cursor: pointer; } .nota { font-size: 12px; color: var(--g-tenue); }
    .msg { border-bottom: 1px solid var(--gris-15); padding: 8px 0 12px; position: relative; }
    .msg header { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; } .msg.abierto header { cursor: default; }
    .msg header .av { margin-left: -56px; margin-top: 2px; width: 40px; height: 40px; font-size: 16px; }
    .quien { flex: 1; min-width: 0; font-size: 14px; } .quien small { color: var(--g-tenue); font-size: 12px; } .quien .d { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .msg header .h { color: var(--g-tenue); font-size: 12px; padding-top: 3px; }
    .cuerpo { width: 100%; min-height: 120px; border: 0; background: #fff; margin-top: 10px; border-radius: 6px; display: block; }
    .texto { white-space: pre-wrap; font-family: inherit; margin: 12px 0 0; font-size: 14px; }
    .adj-t { font-size: 14px; font-weight: 500; margin: 18px 0 10px; padding-top: 14px; border-top: 1px solid var(--gris-15); }
    .tarjetas { display: flex; gap: 12px; flex-wrap: wrap; }
    .t-adj { width: 180px; height: 122px; border: 1px solid var(--gris-2); border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; background: var(--gris-15); }
    .prev { flex: 1; position: relative; display: grid; place-items: center; overflow: hidden; } .prev img { width: 100%; height: 100%; object-fit: cover; }
    .tipo-g { font-size: 22px; font-weight: 800; letter-spacing: .02em; color: #fff; border-radius: 6px; padding: 8px 10px; text-transform: uppercase; }
    .sobre { position: absolute; inset: 0; background: rgba(32,33,36,.6); display: flex; align-items: center; justify-content: center; gap: 10px; opacity: 0; transition: opacity var(--transicion); }
    .t-adj:hover .sobre, .t-adj:focus-within .sobre { opacity: 1; }
    .sobre button { width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(255,255,255,.95); color: #3c4043; min-height: 0; padding: 0; display: grid; place-items: center; box-shadow: none; }
    .pie-adj { height: 34px; background: var(--gris-0); display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12.5px; border-top: 1px solid var(--gris-2); }
    .pie-adj .nom, .adj .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .mini { font-size: 8.5px; font-weight: 800; color: #fff; border-radius: 3px; padding: 2px 3px; text-transform: uppercase; flex: none; }
    .t-pdf { background: #d93025; } .t-img { background: #188038; } .t-xls { background: #188038; } .t-doc { background: #1a73e8; } .t-otro { background: #5f6368; }
    .resp { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
    .pill { display: inline-flex; align-items: center; gap: 8px; height: 40px; min-height: 0; padding: 0 22px 0 16px; border-radius: 999px; border: 1px solid var(--gris-4); background: none; box-shadow: none; font-weight: 500; color: inherit; }
    .pill:hover { background: var(--gris-15); } .pill svg { width: 18px; height: 18px; }
    .fab { display: none; }
    /* Ventana de redactar */
    .ventana { position: fixed; right: 24px; bottom: 0; width: 560px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 72px);
      background: var(--gris-0); border-radius: 10px 10px 0 0; box-shadow: 0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px rgba(0,0,0,.12), 0 5px 5px -3px rgba(0,0,0,.2); display: flex; flex-direction: column; z-index: 60; overflow: hidden; }
    .ventana.min { height: auto; width: 300px; }
    .ventana.max { right: 50%; bottom: 50%; transform: translate(50%, 50%); width: min(1000px, calc(100vw - 48px)); height: min(760px, calc(100vh - 80px)); border-radius: 10px; }
    .ventana > header { display: flex; justify-content: space-between; align-items: center; background: var(--g-sel); padding: 8px 10px 8px 16px; font-weight: 600; font-size: 14px; }
    .ventana.min > header { cursor: pointer; }
    .botones-v { display: flex; gap: 2px; } .botones-v button { background: none; border: 0; color: inherit; min-height: 0; padding: 2px 8px; box-shadow: none; font-size: 15px; border-radius: 4px; }
    .botones-v button:hover { background: rgba(0,0,0,.08); }
    .campos { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
    .linea { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--gris-15); margin: 0 16px; min-height: 40px; }
    .linea > span { color: var(--g-tenue); font-size: 14px; } .linea input { flex: 1; border: 0; box-shadow: none; padding: 9px 0; background: none; border-radius: 0; font-size: 14px; min-width: 0; }
    .linea input:focus { outline: none; } .de-v { color: inherit !important; font-size: 14px; } .cc-l { display: flex; gap: 2px; }
    .enlace { background: none; border: 0; box-shadow: none; color: var(--gris-6); min-height: 0; padding: 2px 4px; font-weight: 400; font-size: 14px; } .enlace:hover { text-decoration: underline; }
    .campos > * { flex: none; } .campos > .editor { flex: 1 0 auto; }
    .editor { min-height: 180px; padding: 12px 16px; font-size: 14px; line-height: 1.45; outline: none; overflow-wrap: anywhere; }
    .editor :is(blockquote) { margin: 0 0 0 .8ex; border-left: 1px solid #ccc; padding-left: 1ex; color: var(--g-tenue); }
    .editor img { max-width: 200px; max-height: 64px; object-fit: contain; }
    .ventana .adjuntar { margin: 0 16px 8px; display: flex; flex-direction: column; gap: 8px; }
    .docs { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--gris-2); border-radius: 10px; padding: 10px; }
    .doc { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--gris-15); padding-top: 6px; font-size: 13px; }
    .fila { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .fila input { flex: 1; min-width: 160px; }
    .adjs { display: flex; flex-direction: column; gap: 6px; }
    .adj { display: flex; gap: 8px; align-items: center; background: var(--gris-15); border-radius: 4px; padding: 5px 10px; font-size: 13px; font-weight: 600; color: var(--g-azul); max-width: 420px; }
    .adj small { color: var(--g-tenue); font-weight: 400; } .adj .x { margin-left: auto; border: 0; background: none; padding: 0 2px; min-height: 0; font-size: 18px; box-shadow: none; color: var(--gris-6); }
    .formato { display: flex; align-items: center; gap: 2px; margin: 0 12px 4px; padding: 4px 6px; border-radius: 8px; box-shadow: 0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15); flex-wrap: wrap; position: relative; }
    .formato button, .color-b { width: 30px; height: 30px; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; border-radius: 4px; display: grid; place-items: center; font-size: 15px; color: var(--gris-6); cursor: pointer; font-weight: 500; }
    .formato button:hover, .color-b:hover { background: var(--gris-15); } .formato svg { width: 18px; height: 18px; }
    .color-b { position: relative; } .color-b span { border-bottom: 3px solid #d93025; line-height: 1; font-weight: 700; } .color-b input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .sep { width: 1px; height: 20px; background: var(--gris-2); margin: 0 4px; }
    .enl { display: flex; gap: 6px; align-items: center; margin-left: 6px; } .enl input { width: 180px; padding: 4px 8px; }
    .ventana footer { display: flex; align-items: center; gap: 4px; padding: 10px 14px 12px 16px; }
    .enviar { border-radius: 999px; padding: 0 24px; height: 36px; min-height: 0; border: 0; background: var(--g-azul); color: #fff; font-weight: 600; box-shadow: none; }
    :host-context([data-tema="oscuro"]) .enviar { color: #062e6f; }
    .enviar:hover:not(:disabled) { box-shadow: 0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15); filter: brightness(1.08); }
    .enviar-g { margin-right: 6px; }
    .icono-v { background: none; border: 0; box-shadow: none; min-height: 0; height: 34px; min-width: 34px; padding: 0 7px; border-radius: 6px; cursor: pointer; font-weight: 500; color: var(--gris-6); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .icono-v:hover, .icono-v.on { background: var(--gris-15); } .icono-v input { display: none; } .texto-v { font-size: 12.5px; } .descartar { margin-left: auto; }
    /* Visor de adjuntos */
    .visor { position: fixed; inset: 0; background: rgba(0,0,0,.82); z-index: 70; display: flex; flex-direction: column; }
    .visor header { display: flex; align-items: center; gap: 6px; padding: 8px 12px 8px 20px; color: #fff; } .visor header span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .v-cuerpo { flex: 1; display: grid; place-items: center; padding: 0 24px 24px; min-height: 0; }
    .v-cuerpo iframe { width: min(1000px, 100%); height: 100%; border: 0; background: #fff; } .v-cuerpo img { max-width: 100%; max-height: 100%; }
    /* Firma */
    .firma-f { display: flex; flex-direction: column; gap: 12px; min-width: min(520px, 80vw); }
    .firma-f label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; font-size: 13px; } .firma-f .chk { flex-direction: row; align-items: center; gap: 8px; font-weight: 500; }
    .logo-f { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 13px; flex-wrap: wrap; } .logo-f img { max-height: 48px; max-width: 160px; }
    .boton-archivo { cursor: pointer; flex-direction: row !important; } .boton-archivo input { display: none; }
    .vista-firma { border: 1px solid var(--gris-2); border-radius: 10px; padding: 10px 14px; } .vista-firma small { color: var(--g-tenue); }
    .gs { color: var(--gris-6); font-size: 13.5px; margin-top: 6px; } .gs img { max-height: 70px; max-width: 220px; margin: 4px 0; } .pre { white-space: pre-line; }
    @media (max-width: 1000px) {
      .hilo { grid-template-columns: 36px 150px minmax(0, 1fr) 76px; } .hilo .chips { display: none; }
      .hilo-v { padding-left: 16px; } .msg header .av { margin-left: 0; }
    }
    @media (max-width: 860px) {
      .menu-b { display: inline-grid; } .logo { width: auto; } .logo { display: none; } .c-txt { display: none; }
      .cuerpo-gm { grid-template-columns: minmax(0, 1fr); }
      .carpetas { position: fixed; inset: 0 auto 0 0; width: 280px; background: var(--gris-0); z-index: 50; padding: 16px 12px 16px 0; transform: translateX(-105%); transition: transform var(--transicion); overflow-y: auto; box-shadow: var(--sombra-menu); }
      .cajon .carpetas { transform: none; } .cajon .velo-c { display: block; position: fixed; inset: 0; background: var(--velo); z-index: 45; }
      .carpetas .redactar { display: none; }
      .fab { display: inline-flex; position: fixed; right: 16px; bottom: 18px; z-index: 40; align-items: center; gap: 12px; height: 56px; padding: 0 20px 0 16px; border-radius: 16px; border: 0;
        background: var(--g-sel); font-weight: 600; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); color: inherit; }
      .principal { border-radius: 12px; }
      .hilo { grid-template-columns: 40px minmax(0, 1fr) auto; grid-template-rows: auto auto auto; grid-template-areas: "av de h" "av txt est" "av ch est"; height: auto; padding: 10px 12px; gap: 1px 12px; background: var(--gris-0); }
      .hilo .av-m { display: grid; grid-area: av; align-self: start; width: 40px; height: 40px; }
      .hilo .de { grid-area: de; } .hilo .h { grid-area: h; } .hilo .estrella { grid-area: est; justify-self: end; }
      .hilo .txt { grid-area: txt; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .hilo .as { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .hilo .pr { font-size: 13px; } .hilo .guion { display: none; }
      .hilo .chips { grid-area: ch; display: flex; flex-wrap: wrap; }
      .hilo:hover { box-shadow: none; }
      .rango { display: none; }
      .tarjetas .t-adj { width: calc(50% - 6px); }
      .ventana, .ventana.max { inset: 0; width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; transform: none; }
      .ventana.min { inset: auto 0 0 0; height: auto; }
      .texto-v { font-size: 0; gap: 0; }
    }
  `],
})
export class Correo {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private san = inject(DomSanitizer);
  private editor = viewChild<ElementRef<HTMLDivElement>>('editor');
  readonly CHIP = CHIP; readonly IC = IC; readonly fecha = fecha; readonly fechaLarga = fechaLarga;
  readonly FECHAS: [string, string][] = [['', 'Cualquier fecha'], ['1d', 'Último día'], ['7d', 'Última semana'], ['30d', 'Último mes'], ['6m', 'Últimos 6 meses'], ['1y', 'Último año']];

  readonly estado = signal<Estado | null>(null);
  readonly carpetas = signal<Carpeta[]>([]);
  readonly propias = signal<Carpeta[]>([]);
  readonly verMas = signal(false);
  readonly carpetasVisibles = computed(() => (this.verMas() ? this.carpetas() : this.carpetas().filter((c) => !['SPAM', 'TRASH'].includes(c.id) || c.id === this.etiqueta())));
  readonly verCajon = signal(false);
  readonly etiqueta = signal('INBOX');
  readonly chips = signal(new Set<string>());
  readonly fechaF = signal('');
  readonly hilos = signal<Hilo[]>([]);
  readonly siguiente = signal('');
  readonly paginas = signal<string[]>([]);   // tokens de las páginas anteriores (para «‹»)
  readonly estimado = signal(0);
  readonly cargandoLista = signal(false);
  readonly hiloSel = signal<Hilo | null>(null);
  readonly detalle = signal<Detalle | null>(null);
  readonly abiertos = signal(new Set<string>());
  readonly miniaturas = signal<Record<string, string>>({});
  readonly visor = signal<{ nombre: string; url: SafeResourceUrl; crudo: string; pdf: boolean; mensaje: string; adj: Adjunto } | null>(null);
  readonly componiendo = signal(false);
  readonly trabajando = signal(false);
  readonly verDocs = signal(false);
  readonly minimizado = signal(false);
  readonly maximizado = signal(false);
  readonly verCc = signal(false);
  readonly verCco = signal(false);
  readonly verFormato = signal(true);
  readonly verEnlace = signal(false);
  readonly tituloBase = signal('');
  readonly tituloVentana = computed(() => this.tituloBase() || 'Mensaje nuevo');
  readonly remitenteVisible = computed(() => { const e = this.estado(); return e ? (e.nombre ? `${e.nombre} <${e.email}>` : e.email) : ''; });
  readonly docs = signal<DocViaje[]>([]);
  readonly adjuntos = signal<Archivo[]>([]);
  readonly documentos = signal<{ viaje: string; tipo: 'manifiesto' | 'remesa'; texto: string }[]>([]);
  readonly editandoFirma = signal(false);
  readonly principales = signal<Pestana[]>([]);
  readonly verMasClientes = signal(false);
  readonly clientesVisibles = computed(() => (this.verMasClientes() ? [...this.principales(), ...this.otros()] : [...this.principales(), ...this.otros().filter((o) => o.id === this.cliente())]));
  readonly otros = signal<Pestana[]>([]);
  readonly cliente = signal('');
  readonly todosClientes = computed(() => [...this.principales(), ...this.otros()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
  todoDominio = false;
  readonly nombreCarpeta = computed(() => [...this.carpetas(), ...this.propias()].find((c) => c.id === this.etiqueta())?.nombre || 'Recibidos');
  readonly rango = computed(() => { const n = this.hilos().length; if (!n) return ''; const ini = this.paginas().length * 25 + 1; const est = this.estimado();
    const fin = ini + n - 1; return `${ini}–${fin} de ${(this.siguiente() ? Math.max(est, fin + 1) : fin).toLocaleString('es-CO')}`; });
  q = ''; qDocs = ''; url = '';
  fNombre = ''; fTexto = ''; fLogo = ''; fEnRespuestas = true;
  resp = { para: '', cc: '', cco: '', asunto: '', hilo: '', enRespuestaA: '', referencias: '' };
  private rangoGuardado: Range | null = null;

  constructor() {
    const g = this.ruta.snapshot.queryParamMap.get('gmail');
    if (g === 'conectado') this.avisos.ok('Gmail conectado');
    if (g === 'cancelado') this.avisos.mostrar('Se canceló la conexión con Google');
    if (g === 'error') this.avisos.mostrar(this.ruta.snapshot.queryParamMap.get('motivo') || 'No se pudo conectar Gmail', 'error');
    if (g) this.router.navigate([], { queryParams: {}, replaceUrl: true });
    this.iniciar();
  }

  private async iniciar() {
    try {
      const e = await this.api.get<Estado>('/gmail/estado'); this.estado.set(e);
      if (e.conectado) { this.cargarClientes(); await Promise.all([this.cargarCarpetas(), this.cargarHilos()]); }
    } catch (err) { this.avisos.error(err); }
  }
  async conectar() {
    this.trabajando.set(true);
    try { const r = await this.api.post<{ url: string }>('/gmail/conectar'); window.location.href = r.url; }
    catch (e) { this.avisos.error(e); this.trabajando.set(false); }
  }
  async desconectar() {
    try { await this.api.delete('/gmail/cuenta'); this.hilos.set([]); this.detalle.set(null); await this.iniciar(); this.avisos.ok('Gmail desconectado'); }
    catch (e) { this.avisos.error(e); }
  }

  // ── Lista ──
  async cargarCarpetas() {
    const r = await this.api.get<{ sistema: Carpeta[]; propias: Carpeta[] }>('/gmail/etiquetas');
    this.carpetas.set(r.sistema); this.propias.set(r.propias);
  }
  async cargarHilos(pagina = '', volverAtras = false) {
    if (!pagina && !volverAtras) this.paginas.set([]);
    this.cargandoLista.set(true);
    try {
      const r = await this.api.get<{ items: Hilo[]; siguiente: string; estimado: number }>('/gmail/hilos',
        { etiqueta: this.etiqueta(), ...(this.cliente() ? { cliente: this.cliente() } : {}), q: this.q.trim(), filtro: [...this.chips()].join(','), fecha: this.fechaF(), pagina });
      this.hilos.set(r.items); this.siguiente.set(r.siguiente); this.estimado.set(r.estimado || 0);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoLista.set(false); }
  }
  private actual = '';
  paginaSiguiente() { const s = this.siguiente(); if (!s) return; this.paginas.update((p) => [...p, this.actual]); this.actual = s; this.cargarHilos(s, true); }
  paginaAnterior() { const p = [...this.paginas()]; const t = p.pop() ?? ''; this.paginas.set(p); this.actual = t; this.cargarHilos(t, true); }
  // ── Etiquetas por cliente ──
  async cargarClientes() {
    try { const r = await this.api.get<{ principales: Pestana[]; otros: Pestana[] }>('/gmail/clientes'); this.principales.set(r.principales); this.otros.set(r.otros); }
    catch { /* sin etiquetas de clientes: la bandeja funciona igual */ }
  }
  abrirCliente(id: string) { this.cliente.set(id || ''); this.etiqueta.set('INBOX'); this.volver(false); this.verCajon.set(false); this.actual = ''; this.cargarHilos(); }
  chipCliente(ev: Event, v: Vinculo & { cliente?: string }) { if (v.tipo !== 'cliente' || !v.cliente || v.cliente === this.cliente()) return; ev.stopPropagation(); this.abrirCliente(v.cliente); }
  nombreCliente(id: string) { return this.todosClientes().find((x) => x.id === id)?.nombre || ''; }
  remitenteDe(d: Detalle) {   // quien escribe en la conversación (si soy yo, a quien le escribo)
    const yo = this.estado()!.email.toLowerCase(); const m = d.mensajes.find((x) => x.de.correo.toLowerCase() !== yo);
    return (m?.de.correo || (d.mensajes[0].para.match(/[^\s<>,"]+@[^\s<>,"]+/)?.[0] ?? '')).toLowerCase();
  }
  dominioDe(d: Detalle) { const dom = this.remitenteDe(d).split('@')[1] || ''; return dom && !PUBLICOS.includes(dom) ? dom : ''; }
  async mover(d: Detalle, cliente: string) {
    const r = this.remitenteDe(d); if (!r) return;
    const remitente = this.todoDominio && this.dominioDe(d) ? `@${this.dominioDe(d)}` : r;
    try {
      await this.api.post('/gmail/reglas', { remitente, cliente, hilo: d.id });
      this.detalle.update((x) => (x ? { ...x, cliente: cliente || null } : x));
      this.avisos.ok(cliente ? `Etiqueta ${this.nombreCliente(cliente)} puesta. Lo de ${remitente} quedará con esa etiqueta (en Gmail: Clientes/${this.nombreCliente(cliente)})` : 'Etiqueta del cliente quitada');
      this.cargarClientes();
    } catch (e) { this.avisos.error(e); }
  }
  abrirCarpeta(id: string) { this.cliente.set(''); this.etiqueta.set(id); this.volver(false); this.verCajon.set(false); this.actual = ''; this.cargarHilos(); }
  chip(c: string) { this.chips.update((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; }); this.actual = ''; this.cargarHilos(); }
  buscar() { this.volver(false); this.actual = ''; this.cargarHilos(); }
  buscarTexto(t: string) { this.q = t; this.etiqueta.set('INBOX'); this.buscar(); }
  volver(recargar = false) { this.hiloSel.set(null); this.detalle.set(null); this.limpiarMiniaturas(); if (recargar) this.cargarHilos(this.actual, true); }
  remitentes(h: Hilo) { return h.participantes.length ? h.participantes.slice(0, 3).join(', ') : h.de.nombre; }
  async destacar(h: Hilo) {
    const si = !h.destacado; const cambia = (x: Hilo) => (x.id === h.id ? { ...x, destacado: si } : x);
    this.hilos.update((l) => l.map(cambia)); if (this.hiloSel()?.id === h.id) this.hiloSel.set(cambia(this.hiloSel()!));
    try { await this.api.post(`/gmail/hilos/${h.id}/destacar`, { si }); } catch (e) { this.avisos.error(e); this.hilos.update((l) => l.map((x) => (x.id === h.id ? { ...x, destacado: !si } : x))); }
  }
  async papelera(h: Hilo) {
    try { await this.api.post(`/gmail/hilos/${h.id}/papelera`); this.hilos.update((l) => l.filter((x) => x.id !== h.id)); this.volver(); this.avisos.ok('Conversación movida a la Papelera'); this.cargarCarpetas().catch(() => null); }
    catch (e) { this.avisos.error(e); }
  }

  // ── Conversación ──
  async abrir(h: Hilo) {
    this.hiloSel.set(h); this.detalle.set(null); this.abiertos.set(new Set()); this.limpiarMiniaturas();
    try {
      const d = await this.api.get<Detalle>(`/gmail/hilos/${h.id}`); this.detalle.set(d);
      this.cargarMiniaturas(d.mensajes.at(-1)!);
      if (h.noLeido) { await this.api.post(`/gmail/hilos/${h.id}/leido`); this.hilos.update((l) => l.map((x) => (x.id === h.id ? { ...x, noLeido: false } : x))); this.cargarCarpetas().catch(() => null); }
    } catch (e) { this.avisos.error(e); }
  }
  alternar(id: string) { this.abiertos.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  // El HTML del correo va en un iframe sin scripts ni formularios (sandbox sin allow-scripts): no puede ejecutar nada; los enlaces abren en otra pestaña.
  // Además se limpia antes (scripts, formularios, on*, javascript:), así el iframe puede medir su alto sin riesgo.
  private cacheHtml = new Map<string, SafeHtml>();
  html(h: string): SafeHtml {
    const ya = this.cacheHtml.get(h); if (ya) return ya;
    const doc = new DOMParser().parseFromString(h, 'text/html');
    doc.querySelectorAll('script,iframe,frame,object,embed,form,input,button,textarea,select,meta,base,link[rel=import],svg script').forEach((x) => x.remove());
    doc.querySelectorAll('*').forEach((el) => { for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase(); const v = at.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || (['href', 'src', 'xlink:href', 'action', 'background', 'poster'].includes(n) && /^(javascript|vbscript|data:text)/.test(v))) el.removeAttribute(at.name);
    } });
    const r = this.san.bypassSecurityTrustHtml(`<base target="_blank"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:0;color:#222;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>${doc.head.innerHTML}${doc.body.innerHTML}`);
    this.cacheHtml.set(h, r); return r;
  }
  ajustar(ev: Event) {   // alto del iframe = alto del correo, como Gmail (sin barra de desplazamiento interna)
    const f = ev.target as HTMLIFrameElement;
    try { const b = f.contentDocument?.body; if (b) f.style.height = `${Math.min(4000, b.scrollHeight + 16)}px`; } catch { /* sin acceso: queda el alto mínimo */ }
  }
  paraCorto(m: Mensaje) {
    const yo = this.estado()!.email.toLowerCase();
    const l = [m.para, m.cc].join(',').split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x.toLowerCase().includes(yo) ? 'mí' : x.replace(/<.*>/, '').replace(/"/g, '').trim() || x));
    return l.slice(0, 3).join(', ') + (l.length > 3 ? '…' : '');
  }
  inicial(n: string) { return (n || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'; }
  color(n: string) { let h = 0; for (const c of n || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORES[h % COLORES.length]; }
  ext(n: string) { return (n.split('.').pop() || '').slice(0, 4); }
  claseTipo(n: string) { const e = this.ext(n).toLowerCase(); return e === 'pdf' ? 't-pdf' : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e) ? 't-img' : ['xls', 'xlsx', 'csv'].includes(e) ? 't-xls' : ['doc', 'docx'].includes(e) ? 't-doc' : 't-otro'; }
  sePuedeVer(n: string) { return !!VER[this.ext(n).toLowerCase()]; }
  kb(b: number) { return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }
  private blob(mensaje: string, a: Adjunto) { return this.api.archivo(`/gmail/mensajes/${mensaje}/adjuntos/${encodeURIComponent(a.id)}`, { nombre: a.nombre }); }
  bajar(mensaje: string, a: Adjunto) { this.api.descargar(`/gmail/mensajes/${mensaje}/adjuntos/${encodeURIComponent(a.id)}`, { nombre: a.nombre }, a.nombre).catch((e) => this.avisos.error(e)); }
  // Vista previa: el archivo llega como blob y se muestra con su tipo real (el navegador abre el PDF en su visor)
  async ver(mensaje: string, a: Adjunto) {
    try {
      const tipo = VER[this.ext(a.nombre).toLowerCase()];
      const crudo = URL.createObjectURL(new Blob([await this.blob(mensaje, a)], { type: tipo }));
      this.visor.set({ nombre: a.nombre, url: this.san.bypassSecurityTrustResourceUrl(crudo), crudo, pdf: tipo === 'application/pdf', mensaje, adj: a });
    } catch (e) { this.avisos.error(e); }
  }
  cerrarVisor() { const v = this.visor(); if (v) URL.revokeObjectURL(v.crudo); this.visor.set(null); }
  private async cargarMiniaturas(m: Mensaje) {
    for (const a of m.adjuntos.filter((x) => this.claseTipo(x.nombre) === 't-img' && x.tamano < 3_000_000).slice(0, 6)) {
      try { const u = URL.createObjectURL(new Blob([await this.blob(m.id, a)], { type: VER[this.ext(a.nombre).toLowerCase()] })); this.miniaturas.update((x) => ({ ...x, [a.id]: u })); } catch { /* sin miniatura */ }
    }
  }
  private limpiarMiniaturas() { for (const u of Object.values(this.miniaturas())) URL.revokeObjectURL(u); this.miniaturas.set({}); }

  // ── Redactar, responder y reenviar ──
  private firmaHtml(): string {
    const f = this.estado()?.firma; if (!f || (!f.texto && !f.logo)) return '';
    return `<div class="gmail_signature" data-firma="1">-- <br>${f.logo ? `<img data-firma="1" src="${esc(f.logo)}" alt="" style="max-width:200px;max-height:64px"><br>` : ''}${esc(f.texto).replace(/\n/g, '<br>')}</div>`;
  }
  private limpiar() { this.adjuntos.set([]); this.documentos.set([]); this.verDocs.set(false); this.docs.set([]); this.qDocs = ''; this.verEnlace.set(false); }
  private abrirVentana(titulo: string, cuerpo: string) {
    this.tituloBase.set(titulo); this.minimizado.set(false); this.verCc.set(!!this.resp.cc); this.verCco.set(!!this.resp.cco); this.componiendo.set(true);
    setTimeout(() => { const el = this.editor()?.nativeElement; if (!el) return; el.innerHTML = cuerpo; el.focus(); const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); });
  }
  redactar() {
    this.limpiar(); this.verCajon.set(false);
    this.resp = { para: '', cc: '', cco: '', asunto: '', hilo: '', enRespuestaA: '', referencias: '' };
    const f = this.firmaHtml(); this.abrirVentana('Mensaje nuevo', `<div><br></div>${f ? `<div><br></div>${f}` : ''}`);
  }
  private cita(m: Mensaje) {
    const f = new Date(m.fecha);
    const cuando = `${f.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')} a las ${f.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}`;
    const texto = m.texto || textoDe(m.html);
    return `<div class="gmail_quote">El ${esc(cuando)}, ${esc(m.de.nombre)} (&lt;${esc(m.de.correo)}&gt;) escribió:<br><blockquote>${esc(texto.trim()).replace(/\n/g, '<br>')}</blockquote></div>`;
  }
  private firmaRespuesta() { return this.estado()?.firma.enRespuestas ? this.firmaHtml() : ''; }
  responder(d: Detalle, todos = false) {
    const m = d.mensajes.at(-1)!; const yo = this.estado()!.email.toLowerCase();
    const otros = todos ? [m.para, m.cc].join(',').split(',').map((x) => x.trim()).filter((x) => x && !x.toLowerCase().includes(yo)) : [];
    this.limpiar();
    this.resp = { para: m.de.correo.toLowerCase() === yo ? m.para : m.de.correo, cc: otros.join(', '), cco: '', asunto: /^re:/i.test(d.asunto) ? d.asunto : `RE: ${d.asunto}`,
      hilo: d.id, enRespuestaA: m.idMensaje, referencias: m.referencias };
    // Sugiere el viaje del correo para adjuntar sus documentos
    const v = d.vinculos.find((x) => x.tipo !== 'cliente'); if (v) { this.qDocs = v.texto.replace('Manifiesto ', ''); this.verDocs.set(true); this.buscarDocs(); }
    const f = this.firmaRespuesta();
    this.abrirVentana(todos ? `Responder a todos: ${d.asunto}` : `RE: ${d.asunto}`, `<div><br></div>${f ? `<div><br></div>${f}` : ''}<div><br></div>${this.cita(m)}`);
  }
  async reenviar(d: Detalle) {
    const m = d.mensajes.at(-1)!; this.limpiar();
    this.resp = { para: '', cc: '', cco: '', asunto: /^(rv|fwd?):/i.test(d.asunto) ? d.asunto : `RV: ${d.asunto}`, hilo: '', enRespuestaA: '', referencias: '' };
    const f = this.firmaRespuesta();
    const texto = m.texto || textoDe(m.html);
    const cab = `---------- Mensaje reenviado ---------<br>De: <b>${esc(m.de.nombre)}</b> &lt;${esc(m.de.correo)}&gt;<br>Date: ${esc(fechaLarga(m.fecha).replace(/ \(.*\)$/, ''))}<br>Subject: ${esc(m.asunto)}<br>To: ${esc(m.para)}<br>${m.cc ? `Cc: ${esc(m.cc)}<br>` : ''}<br>`;
    this.abrirVentana(`RV: ${d.asunto}`, `<div><br></div>${f ? `<div><br></div>${f}` : ''}<div><br></div><div class="gmail_quote">${cab}${esc(texto.trim()).replace(/\n/g, '<br>')}</div>`);
    // Como Gmail: los adjuntos del correo original van incluidos
    for (const a of m.adjuntos) {
      try { const b = await this.blob(m.id, a); this.adjuntos.update((l) => [...l, { nombre: a.nombre, tipo: a.tipo, datos: '', tamano: b.size, _b: b } as Archivo & { _b: Blob }]); }
      catch { this.avisos.mostrar(`No se pudo traer ${a.nombre}`, 'error'); }
    }
  }
  cerrarComposicion() { this.componiendo.set(false); this.maximizado.set(false); }
  descartar() { this.cerrarComposicion(); this.limpiar(); }

  // Formato (barra de Gmail). Pegar entra como texto: nada de estilos ni código de otra página.
  fmt(cmd: string, valor?: string) { this.editor()?.nativeElement.focus(); document.execCommand(cmd, false, valor); }
  color2(ev: Event) { this.fmt('foreColor', (ev.target as HTMLInputElement).value); }
  pegar(ev: ClipboardEvent) { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData?.getData('text/plain') || ''); }
  pedirEnlace() { const s = getSelection(); this.rangoGuardado = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null; this.url = 'https://'; this.verEnlace.set(true); }
  ponerEnlace() {
    const u = this.url.trim(); this.verEnlace.set(false);
    if (!/^(https?:\/\/|mailto:)[^\s"<>]+$/i.test(u)) { if (u && u !== 'https://') this.avisos.mostrar('El vínculo debe empezar con https:// o mailto:', 'error'); return; }
    const el = this.editor()?.nativeElement; if (!el) return; el.focus();
    if (this.rangoGuardado) { const s = getSelection(); s?.removeAllRanges(); s?.addRange(this.rangoGuardado); }
    if (getSelection()?.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(u)}">${esc(u)}</a>`); else document.execCommand('createLink', false, u);
  }
  ponerFirma() {
    const f = this.firmaHtml(); if (!f) { this.abrirFirma(); return; }
    const el = this.editor()?.nativeElement; if (!el) return;
    if (el.querySelector('div[data-firma]')) { this.avisos.mostrar('La firma ya está en el mensaje'); return; }
    el.focus(); document.execCommand('insertHTML', false, `<div><br></div>${f}`);
  }

  async archivos(ev: Event) {
    const inp = ev.target as HTMLInputElement;
    for (const f of Array.from(inp.files || [])) {
      if (f.size > 20 * 1024 * 1024) { this.avisos.mostrar(`${f.name} pasa de 20 MB`, 'error'); continue; }
      this.adjuntos.update((l) => [...l, { nombre: f.name, tipo: f.type || 'application/octet-stream', datos: '', tamano: f.size, _b: f } as Archivo & { _b: Blob }]);
    }
    inp.value = '';
  }
  quitarArchivo(i: number) { this.adjuntos.update((l) => l.filter((_, k) => k !== i)); }
  async buscarDocs() { try { this.docs.set(await this.api.get<DocViaje[]>('/gmail/documentos', { q: this.qDocs })); } catch (e) { this.avisos.error(e); } }
  tieneDoc(viaje: string, tipo: string) { return this.documentos().some((d) => d.viaje === viaje && d.tipo === tipo); }
  alternarDoc(viaje: string, tipo: 'manifiesto' | 'remesa', texto: string) {
    this.documentos.update((l) => (l.some((d) => d.viaje === viaje && d.tipo === tipo) ? l.filter((d) => !(d.viaje === viaje && d.tipo === tipo)) : [...l, { viaje, tipo, texto }]));
  }
  quitarDoc(i: number) { this.documentos.update((l) => l.filter((_, k) => k !== i)); }
  private base64(b: Blob) { return new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = mal; r.readAsDataURL(b); }); }

  async enviar() {
    const el = this.editor()?.nativeElement; if (!el || this.trabajando()) return;
    if (!this.resp.para.trim()) { this.avisos.mostrar('Escriba al menos un destinatario en «Para»', 'error'); return; }
    this.trabajando.set(true);
    try {
      // El logo de la firma viaja incrustado (cid:logo-firma), no como imagen de internet
      const copia = el.cloneNode(true) as HTMLDivElement;
      copia.querySelectorAll('img[data-firma]').forEach((i) => { i.setAttribute('src', 'cid:logo-firma'); i.removeAttribute('data-firma'); });
      copia.querySelectorAll('[data-firma]').forEach((x) => x.removeAttribute('data-firma'));
      const html = `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px">${copia.innerHTML}</div>`;
      const adjuntos = await Promise.all(this.adjuntos().map(async (a) => ({ nombre: a.nombre, tipo: a.tipo, datos: a.datos || await this.base64((a as Archivo & { _b: Blob })._b) })));
      const r = this.resp;
      await this.api.post('/gmail/enviar', { para: r.para, cc: r.cc, cco: r.cco, asunto: r.asunto, texto: el.innerText, html, ...(r.hilo ? { hilo: r.hilo } : {}),
        enRespuestaA: r.enRespuestaA, referencias: r.referencias, adjuntos, documentos: this.documentos().map(({ viaje, tipo }) => ({ viaje, tipo })) });
      this.avisos.ok('Mensaje enviado');
      this.descartar();
      if (r.hilo && this.hiloSel()) await this.abrir(this.hiloSel()!);
      else this.cargarHilos(this.actual, true);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // ── Firma y nombre ──
  abrirFirma() { const e = this.estado()!; this.fNombre = e.nombre; this.fTexto = e.firma.texto; this.fLogo = e.firma.logo; this.fEnRespuestas = e.firma.enRespuestas; this.editandoFirma.set(true); }
  // El logo se achica en el navegador (máx. 400 px de ancho) para que la firma pese poco
  async cargarLogo(ev: Event) {
    const inp = ev.target as HTMLInputElement; const f = inp.files?.[0]; inp.value = ''; if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { this.avisos.mostrar('El logo debe ser PNG o JPG', 'error'); return; }
    const img = new Image(); const u = URL.createObjectURL(f);
    try {
      await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = u; });
      const k = Math.min(1, 400 / img.width); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      this.fLogo = c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
      if (this.fLogo.length > 290_000) { this.fLogo = ''; this.avisos.mostrar('El logo es muy pesado; use uno más pequeño', 'error'); }
    } catch { this.avisos.mostrar('No se pudo leer la imagen', 'error'); } finally { URL.revokeObjectURL(u); }
  }
  async guardarFirma() {
    this.trabajando.set(true);
    try {
      await this.api.put('/gmail/firma', { nombre: this.fNombre, texto: this.fTexto, logo: this.fLogo, enRespuestas: this.fEnRespuestas });
      this.estado.update((e) => (e ? { ...e, nombre: this.fNombre.trim(), firma: { texto: this.fTexto, logo: this.fLogo, enRespuestas: this.fEnRespuestas } } : e));
      this.editandoFirma.set(false); this.avisos.ok('Firma guardada');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
