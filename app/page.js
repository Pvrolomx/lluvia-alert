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
      const map = L.map(mapRef.current).setView([DEFAULT_LAT, DEFAULT_LON], 9)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
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
    mapInstance.current.setView([lat, lon], 9)
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lon])
    }
  }, [mapReady, userLocation])

  // ─── Actualizar capa de radar ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapInstance.current || radarFrames.length === 0) return

    const L = window.L
    const frame = radarFrames[currentFrame]

    if (radarLayer.current) {
      mapInstance.current.removeLayer(radarLayer.current)
    }

    radarLayer.current = L.tileLayer(
      `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      { opacity: 0.8, zIndex: 100 }
    ).addTo(mapInstance.current)

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

  // ─── Consulta de lluvia ──────────────────────────────────────────────────────
  // FIX #8: Open-Meteo devuelve tiempos sin timezone offset ("2026-06-20T14:00").
  // new Date() en ese formato es ambiguo entre UTC y local — diferencia de 6h en PV.
  // Solución: pedir timeformat=unixtime y comparar timestamps numéricos directamente.
  const checkRain = useCallback(async () => {
    const controller = new AbortController()
    const { signal } = controller

    try {
      // RainViewer
      const radarRes = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal })
      const radarData = await radarRes.json()
      const frames = [...(radarData.radar?.past || []), ...(radarData.radar?.nowcast || [])]
      setRadarFrames(frames)
      // FIX #6: no resetear currentFrame en cada refresh para evitar salto visual;
      // solo lo inicializamos si aún no hay frames cargados
      setCurrentFrame(prev => frames.length > 0 && prev === 0 ? Math.max(0, frames.length - 3) : prev)

      // Open-Meteo con timeformat=unixtime
      const meteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${userLocation.lat}&longitude=${userLocation.lon}` +
        `&hourly=precipitation,precipitation_probability,weather_code` +
        `&current=temperature_2m,weather_code,precipitation,cloud_cover` +
        `&timezone=America/Mexico_City&forecast_days=1&timeformat=unixtime`,
        { signal }
      )
      const meteoData = await meteoRes.json()
      setForecast(meteoData)

      const current = meteoData.current
      const hourly = meteoData.hourly
      const nowTs = Date.now() / 1000 // unix seconds

      let precipitationSoon = false
      let precipMinutes = null

      for (let i = 0; i < hourly.time.length; i++) {
        const hourTs = hourly.time[i] // ya es número unix
        const hoursDiff = (hourTs - nowTs) / 3600

        if (hoursDiff >= 0 && hoursDiff <= 2) {
          // FIX #11: precipitation_probability puede estar ausente → fallback a 0
          const prob = hourly.precipitation_probability?.[i] ?? 0
          if ((hourly.precipitation[i] ?? 0) > 0 || prob > 50) {
            precipitationSoon = true
            precipMinutes = Math.round(hoursDiff * 60)
            break
          }
        }
      }

      if (current.precipitation > 0) {
        setRainAlert({ type: 'raining', message: '¡Está lloviendo!', precipitation: current.precipitation })
      } else if (precipitationSoon) {
        setRainAlert({
          type: 'soon',
          message: precipMinutes <= 15 ? `🚨 Lluvia en ~${precipMinutes} min` : `⚠️ Lluvia en ~${precipMinutes} min`,
          minutes: precipMinutes
        })
      } else {
        setRainAlert({ type: 'clear', message: '☀️ Sin lluvia próxima' })
      }

      setLastUpdate(new Date().toLocaleTimeString('es-MX'))
      setLoading(false)

    } catch (error) {
      if (error.name === 'AbortError') return // desmonte limpio, no es error
      console.error('Error al consultar APIs:', error)
      setRainAlert({ type: 'error', message: '⚠️ Sin conexión al radar' })
      setLoading(false)
    }

    return () => controller.abort()
  }, [userLocation]) // FIX #3: userLocation en deps de useCallback

  // ─── Trigger inicial y refresco cada 5 min ───────────────────────────────────
  useEffect(() => {
    if (!userLocation.lat) return
    const abort = checkRain()
    const interval = setInterval(checkRain, 5 * 60 * 1000)
    return () => {
      clearInterval(interval)
      if (typeof abort?.then === 'function') abort.then(fn => fn?.())
    }
  }, [checkRain]) // FIX #3: checkRain en deps (estable via useCallback)

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
              <button onClick={checkRain} className="text-2xl hover:scale-110 transition-transform">🔄</button>
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
