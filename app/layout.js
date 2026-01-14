import './globals.css'

export const metadata = {
  title: 'Lluvia Alert - Las Ceibas',
  description: 'Alerta de lluvia 10-15 min antes',
  manifest: '/manifest.json',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
