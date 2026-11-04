// La última consulta manda: si se cambió de pestaña o de filtro mientras otra consulta seguía en curso,
// su respuesta tardía se descarta y no reemplaza lo que corresponde a la pantalla actual.
export class Turno {
  private n = 0;
  // Nueva consulta (invalida las anteriores); devuelve si sigue siendo la vigente
  tomar() { const t = ++this.n; return () => t === this.n; }
  // Consulta que depende de la actual (p. ej. «cargar más»); no invalida nada
  actual() { const t = this.n; return () => t === this.n; }
}
