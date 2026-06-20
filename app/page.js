'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// Puerto Vallarta / Bahía de Banderas
const DEFAULT_LAT = 20.65
const DEFAULT_LON = -105.23
const LOCATION_NAME = "Puerto Vallarta"

export default function Home() {
  const [rainAlert, setRainAlert] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [radarFrames, setRadarFrames] = useState([])
  const [currentFrame, setCurrentFrame] = useState(0)
  const [mapReady, setMapReady] = useState(false)
  const [userLocation, setUserLocation] = useState({ lat: DEFAULT_LAT, lon: DEFAULT_LON })
  const [locationName, setLocationName] = useState(LOCATION_NAME)

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markerRef = useRef(null)
  const radarLayer = useRef(null)
  const controllerRef = useRef(null)    // AbortController activo
  const radarInitialized = useRef(false) // FIX #2: flag de primer frame cargado

  // ─── Geolocalización ────────────────────────────────────────────────────────
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })
          setLocationName("Tu ubicación")
        },
        () => {
          setUserLocation({ lat: DEFAULT_LAT, lon: DEFAULT_LON })
        }
      )
    }
  }, [])

  // ─── PWA Install Prompt ──────────────────────────────────────────────────────
  useEffect(() => {
    // Si ya está instalada como PWA standalone, no mostrar botón
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShowInstall(false)
      return
    }
    // En iOS Safari no hay beforeinstallprompt — mostrar botón siempre
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    if (isIOS) {
      setShowInstall(true)
      return
    }
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // ─── Init mapa (solo una vez) ────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || mapInstance.current) return

    let cancelled = false

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => {
      if (cancelled || !mapRef.current || mapInstance.current) return

      const L = window.L
      const map = L.map(mapRef.current, {
        scrollWheelZoom: false,
        doubleClickZoom: false,
        dragging: false,
        zoomControl: false,
        minZoom: 5,
        maxZoom: 10,
      }).setView([DEFAULT_LAT, DEFAULT_LON], 7)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        minZoom: 5,
        maxZoom: 10,
      }).addTo(map)

      // Marker inicial en default; se actualiza cuando llega geoloc
      markerRef.current = L.circleMarker([DEFAULT_LAT, DEFAULT_LON], {
        radius: 10,
        fillColor: '#3b82f6',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.8
      }).addTo(map).bindPopup('📍 Tu ubicación')

      mapInstance.current = map
      setMapReady(true)
    }
    document.body.appendChild(script)

    return () => {
      cancelled = true
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
        markerRef.current = null
      }
      // Limpiar script y link inyectados
      script.remove()
      link.remove()
    }
  }, []) // solo una vez

  // ─── Recentrar mapa cuando cambia userLocation ───────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return
    const { lat, lon } = userLocation
    mapInstance.current.setView([lat, lon], 7)
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lon])
    }
  }, [mapReady, userLocation])

  // ─── Actualizar capa de radar ────────────────────────────────────────────────
  // El layer se crea UNA SOLA VEZ con el primer frame; en animaciones posteriores
  // solo se actualiza la URL vía setUrl() para evitar el parpadeo de remove/add
  // y el "Zoom Level Not Supported" que aparece mientras el nuevo layer carga.
  useEffect(() => {
    if (!mapReady || !mapInstance.current || radarFrames.length === 0) return

    const L = window.L
    const frame = radarFrames[currentFrame]
    const url = `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`

    if (!radarLayer.current) {
      // Primera vez: crear el layer
      radarLayer.current = L.tileLayer(url, {
        opacity: 0.6,
        zIndex: 100,
        minZoom: 5,
        maxZoom: 10,
      }).addTo(mapInstance.current)
    } else {
      // Frames siguientes: solo actualizar la URL, sin remove/add
      radarLayer.current.setUrl(url)
    }

  }, [mapReady, radarFrames, currentFrame])

  // ─── Instalar PWA ────────────────────────────────────────────────────────────
  const installApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') setShowInstall(false)
      setDeferredPrompt(null)
    } else {
      alert('Para instalar:\n\n📱 iPhone: Toca "Compartir" → "Agregar a inicio"\n\n🤖 Android: Toca el menú (⋮) → "Instalar app"')
    }
  }

  // ─── Helpers de radar ───────────────────────────────────────────────────────

  // Convertir lat/lon a índices de tile y pixel exacto dentro del tile (256x256)
  const latLonToTilePixel = useCallback((lat, lon, zoom) => {
    const latRad = lat * Math.PI / 180
    const n = Math.pow(2, zoom)
    const xFloat = (lon + 180) / 360 * n
    const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    return {
      tileX: Math.floor(xFloat),
      tileY: Math.floor(yFloat),
      pixelX: Math.floor((xFloat % 1) * 256),
      pixelY: Math.floor((yFloat % 1) * 256),
    }
  }, [])

  // Leer intensidad de precipitación en el punto exacto del usuario via Canvas.
  // RainViewer scheme 2: pixel transparente = sin lluvia; color → mm/h.
  // Esto reemplaza current.precipitation de Open-Meteo (modelo de grilla ~5km).
  const getRadarIntensityAtLocation = useCallback(async (framePath, lat, lon) => {
    const ZOOM = 6
    const { tileX, tileY, pixelX, pixelY } = latLonToTilePixel(lat, lon, ZOOM)
    const url = `https://tilecache.rainviewer.com${framePath}/256/${ZOOM}/${tileX}/${tileY}/2/1_1.png`

    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const [r, g, b, a] = ctx.getImageData(pixelX, pixelY, 1, 1).data
        if (a < 10) { resolve(0); return } // transparente = sin lluvia

        // Mapa de colores RainViewer scheme 2 → intensidad mm/h
        const colorMap = [
          [[0, 236, 236], 0.1],   // cyan - llovizna
          [[1, 160, 246], 0.3],   // azul claro
          [[0, 0, 246], 0.5],     // azul
          [[0, 255, 0], 1.0],     // verde
          [[0, 200, 0], 2.0],     // verde medio
          [[0, 144, 0], 4.0],     // verde oscuro
          [[255, 255, 0], 6.0],   // amarillo
          [[231, 192, 0], 10.0],  // amarillo oscuro
          [[255, 144, 0], 16.0],  // naranja
          [[255, 0, 0], 25.0],    // rojo
          [[214, 0, 0], 40.0],    // rojo oscuro
          [[255, 0, 255], 64.0],  // magenta
          [[153, 85, 201], 80.0], // violeta
        ]
        let minDist = Infinity, intensity = 0
        for (const [[cr, cg, cb], mm] of colorMap) {
          const d = Math.sqrt((r-cr)**2 + (g-cg)**2 + (b-cb)**2)
          if (d < minDist) { minDist = d; intensity = mm }
        }
        resolve(intensity)
      }
      img.onerror = () => resolve(-1) // error de carga → no concluyente
      img.src = url
    })
  }, [latLonToTilePixel])

  // ─── Consulta de lluvia ──────────────────────────────────────────────────────
  // "Está lloviendo AQUÍ" se determina leyendo el pixel del tile de radar en las
  // coordenadas GPS exactas del usuario — no el modelo Open-Meteo (~5km de grilla).
  const checkRain = useCallback(async (signal) => {
    try {
      // 1. RainViewer — frames para mapa y lectura de punto
      const radarRes = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal })
      const radarData = await radarRes.json()
      const frames = [...(radarData.radar?.past || []), ...(radarData.radar?.nowcast || [])]
      setRadarFrames(frames)
      if (!radarInitialized.current && frames.length > 0) {
        setCurrentFrame(Math.max(0, frames.length - 3))
        radarInitialized.current = true
      }

      // 2. Open-Meteo — temperatura, ícono y pronóstico horario (ya sin precipitation current)
      const meteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${userLocation.lat}&longitude=${userLocation.lon}` +
        `&hourly=precipitation,precipitation_probability,weather_code` +
        `&current=temperature_2m,weather_code,cloud_cover` +
        `&timezone=America/Mexico_City&forecast_days=1&timeformat=unixtime`,
        { signal }
      )
      const meteoData = await meteoRes.json()
      setForecast(meteoData)

      // 3. Lectura de radar en punto exacto (frame más reciente)
      let radarIntensity = 0
      if (frames.length > 0) {
        const lastFrame = frames[frames.length - 1]
        radarIntensity = await getRadarIntensityAtLocation(
          lastFrame.path, userLocation.lat, userLocation.lon
        )
      }

      // 4. Pronóstico próximas 2h via Open-Meteo hourly
      const hourly = meteoData.hourly
      const nowTs = Date.now() / 1000
      let precipitationSoon = false
      let precipMinutes = null

      for (let i = 0; i < hourly.time.length; i++) {
        const hoursDiff = (hourly.time[i] - nowTs) / 3600
        if (hoursDiff >= 0 && hoursDiff <= 2) {
          const prob = hourly.precipitation_probability?.[i] ?? 0
          if ((hourly.precipitation[i] ?? 0) > 0.2 || prob > 60) {
            precipitationSoon = true
            precipMinutes = Math.round(hoursDiff * 60)
            break
          }
        }
      }

      // 5. Decisión: radar punto (fuente primaria) > modelo área (pronóstico)
      if (radarIntensity > 0) {
        const label = radarIntensity >= 16 ? '⛈️ Lluvia intensa'
          : radarIntensity >= 4  ? '🌧️ Lloviendo'
          : '🌦️ Llovizna cerca'
        setRainAlert({ type: 'raining', message: label, precipitation: radarIntensity })
      } else if (precipitationSoon) {
        setRainAlert({
          type: 'soon',
          message: precipMinutes <= 15
            ? `🚨 Lluvia en ~${precipMinutes} min`
            : `⚠️ Lluvia en ~${precipMinutes} min`,
          minutes: precipMinutes
        })
      } else {
        setRainAlert({ type: 'clear', message: '☀️ Sin lluvia aquí' })
      }

      setLastUpdate(new Date().toLocaleTimeString('es-MX'))
      setLoading(false)

    } catch (error) {
      if (error.name === 'AbortError') return
      console.error('Error al consultar APIs:', error)
      setRainAlert({ type: 'error', message: '⚠️ Sin conexión al radar' })
      setLoading(false)
    }

  }, [userLocation, getRadarIntensityAtLocation]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Trigger manual y automático — fuente única de verdad ─────────────────
  // run() es el único punto que crea/aborta el controller y llama checkRain.
  // Lo usan tanto el effect (intervalo de 5min) como el botón 🔄 manual.
  const run = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = new AbortController()
    checkRain(controllerRef.current.signal)
  }, [checkRain])

  useEffect(() => {
    run()
    const interval = setInterval(run, 5 * 60 * 1000)
    return () => {
      clearInterval(interval)
      controllerRef.current?.abort()
    }
  }, [run])

  // ─── Animación de radar ──────────────────────────────────────────────────────
  useEffect(() => {
    if (radarFrames.length === 0) return
    const interval = setInterval(() => {
      setCurrentFrame(prev => (prev + 1) % radarFrames.length)
    }, 800)
    return () => clearInterval(interval)
  }, [radarFrames])

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const getWeatherIcon = (code) => {
    if (code === 0) return '☀️'
    if (code <= 2) return '🌤️'
    if (code <= 49) return '☁️'
    if (code <= 69) return '🌧️'
    if (code <= 79) return '🌨️'
    if (code <= 99) return '⛈️'
    return '🌤️'
  }

  const getAlertColor = () => {
    if (!rainAlert) return 'bg-gray-800'
    if (rainAlert.type === 'raining') return 'bg-blue-600'
    if (rainAlert.type === 'soon' && rainAlert.minutes <= 15) return 'bg-red-600'
    if (rainAlert.type === 'soon') return 'bg-yellow-600'
    if (rainAlert.type === 'error') return 'bg-orange-700'
    return 'bg-green-700'
  }

  const getFrameTime = () => {
    if (radarFrames.length === 0) return ''
    const frame = radarFrames[currentFrame]
    return new Date(frame.time * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-lg mx-auto p-4">

        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold mb-1">🌧️ Lluvia PV</h1>
          <p className="text-gray-400 text-sm">📍 {locationName}</p>
        </div>

        {/* FIX #4: Botón condicionado a showInstall (antes era siempre visible) */}
        {showInstall && (
          <button
            onClick={installApp}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-xl p-4 mb-4 flex items-center justify-center gap-2 shadow-lg"
          >
            <span className="text-xl">📲</span>
            <span className="font-bold">Instalar App</span>
          </button>
        )}

        {/* Alert Card */}
        <div className={`${getAlertColor()} rounded-2xl p-5 mb-4 transition-all duration-500`}>
          {loading ? (
            <div className="text-center py-4">
              <div className="animate-spin text-3xl mb-2">🔄</div>
              <p>Consultando radar...</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-4xl mb-2">
                {rainAlert?.type === 'raining' && '🌧️'}
                {rainAlert?.type === 'soon' && '⚠️'}
                {rainAlert?.type === 'clear' && '☀️'}
                {rainAlert?.type === 'error' && '📡'}
              </div>
              <p className="text-xl font-bold">{rainAlert?.message}</p>
              {rainAlert?.type === 'raining' && (
                <p className="text-sm opacity-80 mt-1">{rainAlert.precipitation} mm</p>
              )}
            </div>
          )}
        </div>

        {/* Radar Map */}
        <div className="bg-gray-800 rounded-xl overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
            <span className="text-sm text-gray-400">🛰️ Radar en vivo</span>
            <span className="text-xs text-blue-400">{getFrameTime()}</span>
          </div>
          <div
            ref={mapRef}
            className="w-full h-64"
            style={{ background: '#e5e7eb' }}
          />
          <div className="px-4 py-2 flex items-center gap-2">
            <div className="flex-1 bg-gray-700 rounded-full h-1">
              <div
                className="bg-blue-500 h-1 rounded-full transition-all"
                style={{ width: radarFrames.length > 0 ? `${((currentFrame + 1) / radarFrames.length) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs text-gray-500">
              {radarFrames.length > 0 ? `${currentFrame + 1}/${radarFrames.length}` : '--'}
            </span>
          </div>
        </div>

        {/* Current Conditions */}
        {forecast && (
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{getWeatherIcon(forecast.current?.weather_code)}</span>
                <span className="text-3xl font-bold">{Math.round(forecast.current?.temperature_2m)}°C</span>
              </div>
              <button onClick={run} className="text-2xl hover:scale-110 transition-transform">🔄</button>
            </div>
          </div>
        )}

        {/* Hourly Forecast */}
        {forecast?.hourly && (
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <h2 className="text-sm text-gray-400 mb-3">Próximas horas</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {forecast.hourly.time.slice(0, 8).map((time, i) => {
                // time ya es unix timestamp (timeformat=unixtime)
                const hour = new Date(time * 1000).getHours()
                const prob = forecast.hourly.precipitation_probability?.[i] ?? 0
                return (
                  <div key={i} className="flex-shrink-0 text-center min-w-[45px]">
                    <p className="text-xs text-gray-400">{hour}:00</p>
                    <p className="text-lg my-1">{getWeatherIcon(forecast.hourly.weather_code[i])}</p>
                    <p className={`text-xs font-medium ${prob > 50 ? 'text-blue-400' : 'text-gray-500'}`}>{prob}%</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-500 py-2">
          <p>Actualizado: {lastUpdate || '...'}</p>
          <p className="mt-1">Open-Meteo + RainViewer</p>
          <p className="mt-2">Hecho con ❤️ por <span className="text-blue-400">C0</span> — Colmena 2026</p>
        </div>

      </div>
    </main>
  )
}
