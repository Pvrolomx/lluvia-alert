import './globals.css'

export const metadata = {
  title: 'Lluvia Alert - Las Ceibas',
  description: 'Alerta de lluvia 10-15 min antes',
  manifest: '/manifest.json',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(reg) { console.log('SW registrado:', reg.scope) })
                    .catch(function(err) { console.warn('SW fallo:', err) })
                })
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
