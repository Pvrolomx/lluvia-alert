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
  const [showDetails, setShowDetails] = useState(false)

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

  // Decodificar color de pixel RainViewer scheme 2 → intensidad mm/h
  // Pixel transparente (alpha < 10) = sin señal de radar = 0 mm/h
  const decodeRadarColor = useCallback((r, g, b, a) => {
    if (a < 10) return 0
    const colorMap = [
      [[0, 236, 236], 0.1],   // cyan — llovizna
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
    return intensity
  }, [])

  // Leer intensidad máxima en una matriz NxN de píxeles alrededor del usuario.
  // Descarga el tile UNA SOLA VEZ y escanea la matriz en memoria via Canvas.
  // Zoom 8: ~300m/pixel → matriz 5×5 cubre ~1.5km de radio. Sin requests extra.
  const getRadarIntensityAtLocation = useCallback(async (framePath, lat, lon) => {
    const ZOOM = 8
    const MATRIX = 5          // escanear 5×5 pixels alrededor del centro
    const HALF = Math.floor(MATRIX / 2)
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
        // Leer toda la región de una vez (más eficiente que N getImageData)
        const x0 = Math.max(0, pixelX - HALF)
        const y0 = Math.max(0, pixelY - HALF)
        const w = Math.min(256 - x0, MATRIX)
        const h = Math.min(256 - y0, MATRIX)
        const imageData = ctx.getImageData(x0, y0, w, h).data
        let maxIntensity = 0
        for (let i = 0; i < imageData.length; i += 4) {
          const v = decodeRadarColor(imageData[i], imageData[i+1], imageData[i+2], imageData[i+3])
          if (v > maxIntensity) maxIntensity = v
        }
        resolve(maxIntensity)
      }
      img.onerror = () => resolve(-1)
      img.src = url
    })
  }, [latLonToTilePixel, decodeRadarColor])

  // ─── Consulta de lluvia ──────────────────────────────────────────────────────
  // Fuentes en orden de prioridad:
  // 1. Radar RainViewer en punto (frame actual)  — qué hay AHORA
  // 2. Nowcast RainViewer en punto (frames +5..+30 min) — qué se acerca
  // 3. Open-Meteo minutely_15 (resolución 15 min) — modelo de respaldo
  const checkRain = useCallback(async (signal) => {
    try {
      // ── A. RainViewer ────────────────────────────────────────────────────────
      const radarRes = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal })
      const radarData = await radarRes.json()
      const pastFrames   = radarData.radar?.past     || []
      const nowcastFrames = radarData.radar?.nowcast || []
      const allFrames = [...pastFrames, ...nowcastFrames]
      setRadarFrames(allFrames)
      if (!radarInitialized.current && allFrames.length > 0) {
        setCurrentFrame(Math.max(0, allFrames.length - nowcastFrames.length - 1))
        radarInitialized.current = true
      }

      // ── B. Open-Meteo minutely_15 ────────────────────────────────────────────
      const meteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${userLocation.lat}&longitude=${userLocation.lon}` +
        `&minutely_15=precipitation,precipitation_probability` +
        `&current=temperature_2m,weather_code,cloud_cover` +
        `&hourly=weather_code` +
        `&forecast_hours=3&timezone=America/Mexico_City&timeformat=unixtime`,
        { signal }
      )
      const meteoData = await meteoRes.json()
      setForecast(meteoData)

      // ── C. Radar presente — intensidad en matriz 5×5 alrededor del GPS ───────
      let radarNow = 0
      if (pastFrames.length > 0) {
        radarNow = await getRadarIntensityAtLocation(
          pastFrames[pastFrames.length - 1].path,
          userLocation.lat, userLocation.lon
        )
      }

      // ── D. Nowcast RainViewer — leer primeros 3 frames (+5, +10, +15 min) ───
      // Solo leemos 3 frames: más allá de +15 min la extrapolación es poco fiable
      // para convección local. Se leen en paralelo para no acumular latencia.
      let nowcastAlert = null
      if (radarNow === 0 && nowcastFrames.length > 0) {
        const nowTs = Date.now() / 1000
        const framesToCheck = nowcastFrames.slice(0, 3)
        const intensities = await Promise.all(
          framesToCheck.map(f =>
            getRadarIntensityAtLocation(f.path, userLocation.lat, userLocation.lon)
          )
        )
        for (let i = 0; i < framesToCheck.length; i++) {
          if (intensities[i] > 0) {
            const minutes = Math.round((framesToCheck[i].time - nowTs) / 60)
            nowcastAlert = { minutes, intensity: intensities[i] }
            break
          }
        }
      }

      // ── E. Open-Meteo minutely_15 — respaldo para ventana 15-45 min ─────────
      // Solo se usa si el radar (presente + nowcast) no detectó nada
      let meteoAlert = null
      if (radarNow === 0 && !nowcastAlert) {
        const m15 = meteoData.minutely_15
        if (m15) {
          const nowTs = Date.now() / 1000
          for (let i = 0; i < m15.time.length; i++) {
            const minsDiff = (m15.time[i] - nowTs) / 60
            if (minsDiff < 0) continue
            if (minsDiff > 45) break
            const prob = m15.precipitation_probability?.[i] ?? 0
            const precip = m15.precipitation?.[i] ?? 0
            if (precip > 0.2 || prob > 65) {
              meteoAlert = { minutes: Math.round(minsDiff) }
              break
            }
          }
        }
      }

      // ── F. Decisión final ────────────────────────────────────────────────────
      // Prioridad: radar ahora > nowcast radar > modelo 15min
      if (radarNow > 0) {
        const label = radarNow >= 16 ? '⛈️ Lluvia intensa'
          : radarNow >= 4  ? '🌧️ Lloviendo'
          : '🌦️ Llovizna'
        setRainAlert({ type: 'raining', message: label, precipitation: radarNow })
      } else if (nowcastAlert) {
        const urgent = nowcastAlert.minutes <= 15
        setRainAlert({
          type: 'soon',
          message: urgent
            ? `🚨 Lluvia en ~${nowcastAlert.minutes} min`
            : `⚠️ Lluvia en ~${nowcastAlert.minutes} min`,
          minutes: nowcastAlert.minutes,
          source: 'radar'
        })
      } else if (meteoAlert) {
        setRainAlert({
          type: 'soon',
          message: `⚠️ Puede llover en ~${meteoAlert.minutes} min`,
          minutes: meteoAlert.minutes,
          source: 'model'
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

  // ─── Helpers de render ───────────────────────────────────────────────────────
  const getWeatherIcon = (code) => {
    if (code === 0) return '☀️'
    if (code <= 2) return '🌤️'
    if (code <= 49) return '☁️'
    if (code <= 69) return '🌧️'
    if (code <= 79) return '🌨️'
    if (code <= 99) return '⛈️'
    return '🌤️'
  }

  const getFrameTime = () => {
    if (radarFrames.length === 0) return ''
    const frame = radarFrames[currentFrame]
    return new Date(frame.time * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  // Semáforo: color de fondo + color del círculo + veredicto para el caso de uso perros
  const getSemaphore = () => {
    if (loading) return { bg: 'bg-gray-900', circle: 'bg-gray-700', verdict: '...', sub: 'Consultando radar' }
    if (!rainAlert) return { bg: 'bg-gray-900', circle: 'bg-gray-700', verdict: '...', sub: '' }

    switch (rainAlert.type) {
      case 'raining':
        return {
          bg: 'bg-red-950',
          circle: rainAlert.precipitation >= 16 ? 'bg-red-500' : 'bg-orange-500',
          verdict: '🔴 NO SALGAS',
          sub: rainAlert.message,
        }
      case 'soon':
        return {
          bg: rainAlert.minutes <= 15 ? 'bg-red-950' : 'bg-yellow-950',
          circle: rainAlert.minutes <= 15 ? 'bg-red-500' : 'bg-yellow-500',
          verdict: rainAlert.minutes <= 15 ? '🔴 ESPERA' : '🟡 CON CUIDADO',
          sub: rainAlert.message,
        }
      case 'clear':
        return { bg: 'bg-green-950', circle: 'bg-green-500', verdict: '🟢 ¡SALTE!', sub: 'Sin lluvia aquí' }
      case 'error':
        return { bg: 'bg-gray-900', circle: 'bg-orange-700', verdict: '📡', sub: 'Sin conexión al radar' }
      default:
        return { bg: 'bg-gray-900', circle: 'bg-gray-700', verdict: '...', sub: '' }
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  const sem = getSemaphore()

  return (
    <main className={`min-h-screen ${sem.bg} text-white transition-colors duration-700`}>
      <div className="max-w-lg mx-auto flex flex-col min-h-screen p-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 pt-2">
          <div>
            <h1 className="text-lg font-bold">🌧️ Lluvia PV</h1>
            <p className="text-xs text-gray-400">📍 {locationName}</p>
          </div>
          <div className="flex items-center gap-3">
            {showInstall && (
              <button
                onClick={installApp}
                className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg"
              >
                📲 Instalar
              </button>
            )}
            <button onClick={run} className="text-xl hover:scale-110 transition-transform active:scale-95">
              🔄
            </button>
          </div>
        </div>

        {/* ── SEMÁFORO — protagonista ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center justify-center py-6">

          {/* Círculo semáforo */}
          <div className={`${sem.circle} rounded-full flex items-center justify-center shadow-2xl transition-colors duration-700 mb-6`}
            style={{ width: 200, height: 200 }}>
            {loading
              ? <div className="animate-spin text-5xl">🔄</div>
              : <span className="text-6xl font-black tracking-tight text-white drop-shadow-lg text-center px-4 leading-tight">
                  {sem.verdict}
                </span>
            }
          </div>

          {/* Subtítulo */}
          <p className="text-center text-xl font-semibold text-white/90 mb-1">{sem.sub}</p>

          {/* Temperatura + fuente */}
          {forecast?.current && (
            <p className="text-center text-sm text-white/50 mt-1">
              {getWeatherIcon(forecast.current.weather_code)} {Math.round(forecast.current.temperature_2m)}°C
              {rainAlert?.source === 'model' && <span className="ml-2 text-yellow-400/70">· modelo</span>}
            </p>
          )}

          {/* Última actualización */}
          <p className="text-xs text-white/30 mt-3">
            {lastUpdate ? `Actualizado ${lastUpdate}` : 'Consultando...'}
          </p>
        </div>

        {/* ── DETALLES — colapsados por defecto ──────────────────────────────── */}
        <div className="mt-auto">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="w-full text-center text-sm text-white/40 hover:text-white/70 py-3 transition-colors"
          >
            {showDetails ? '▲ Ocultar detalles' : '▼ Ver radar y pronóstico'}
          </button>

          {showDetails && (
            <div className="space-y-3 pb-4">

              {/* Mapa de radar */}
              <div className="bg-white/5 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
                  <span className="text-sm text-gray-400">🛰️ Radar en vivo</span>
                  <span className="text-xs text-blue-400">{getFrameTime()}</span>
                </div>
                <div ref={mapRef} className="w-full h-56" style={{ background: '#1a2030' }} />
                <div className="px-4 py-2 flex items-center gap-2">
                  <div className="flex-1 bg-white/10 rounded-full h-1">
                    <div
                      className="bg-blue-400 h-1 rounded-full transition-all"
                      style={{ width: radarFrames.length > 0 ? `${((currentFrame + 1) / radarFrames.length) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {radarFrames.length > 0 ? `${currentFrame + 1}/${radarFrames.length}` : '--'}
                  </span>
                </div>
              </div>

              {/* Próximas horas (minutely_15 → mostramos slots de 15min) */}
              {forecast?.minutely_15 && (
                <div className="bg-white/5 rounded-xl p-4">
                  <h2 className="text-xs text-gray-400 mb-3 uppercase tracking-wide">Próximos 90 min</h2>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {forecast.minutely_15.time.slice(0, 6).map((time, i) => {
                      const t = new Date(time * 1000)
                      const label = `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`
                      const prob = forecast.minutely_15.precipitation_probability?.[i] ?? 0
                      const precip = forecast.minutely_15.precipitation?.[i] ?? 0
                      const hasRain = precip > 0 || prob > 50
                      return (
                        <div key={i} className="flex-shrink-0 text-center min-w-[50px]">
                          <p className="text-xs text-gray-400">{label}</p>
                          <p className="text-lg my-1">{precip > 0 ? '🌧️' : prob > 50 ? '🌦️' : '☀️'}</p>
                          <p className={`text-xs font-medium ${hasRain ? 'text-blue-400' : 'text-gray-500'}`}>
                            {prob}%
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Footer */}
              <p className="text-center text-xs text-white/20 py-1">
                RainViewer + Open-Meteo · Hecho con ❤️ por C0 — Colmena 2026
              </p>

            </div>
          )}
        </div>

      </div>
    </main>
  )
}

