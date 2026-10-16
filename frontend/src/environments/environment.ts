// Producción: el frontend y la API se publican en el mismo dominio (/api).
export const environment = {
  produccion: true,
  // Cierre de sesión por inactividad (minutos)
  inactividadMin: 30,
  apiUrl: '/api',
};
