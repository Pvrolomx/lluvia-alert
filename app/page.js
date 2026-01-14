'use client'
import { useState, useEffect } from 'react'

// Las Ceibas, Bahía de Banderas, Nayarit
const LAT = 20.805
const LON = -105.296
const LOCATION_NAME = "Las Ceibas, Bahía de Banderas"

export default function Home() {
  const [rainAlert, setRainAlert] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [radarTime, setRadarTime] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)

  // PWA Install Prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const installApp = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShowInstall(false)
    }
    setDeferredPrompt(null)
  }

  const checkRain = async () => {
    try {
      // RainViewer API - Radar data
      const radarRes = await fetch('https://api.rainviewer.com/public/weather-maps.json')
      const radarData = await radarRes.json()
      
      const past = radarData.radar?.past || []
      
      // Get latest radar frame
      const latestFrame = past[past.length - 1]
      if (latestFrame) {
        setRadarTime(new Date(latestFrame.time * 1000).toLocaleTimeString('es-MX'))
      }
      
      // Open-Meteo API - Hourly precipitation
      const meteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=precipitation,precipitation_probability,weather_code&current=temperature_2m,weather_code,precipitation&timezone=America/Mexico_City&forecast_days=1`
      )
      const meteoData = await meteoRes.json()
      
      setForecast(meteoData)
      
      // Check current and upcoming precipitation
      const current = meteoData.current
      const hourly = meteoData.hourly
      
      // Find current hour index
      const now = new Date()
      
      // Check next 2 hours for precipitation
      let precipitationSoon = false
      let precipMinutes = null
      
      for (let i = 0; i < hourly.time.length; i++) {
        const hourTime = new Date(hourly.time[i])
        const hoursDiff = (hourTime - now) / (1000 * 60 * 60)
        
        if (hoursDiff >= 0 && hoursDiff <= 2) {
          if (hourly.precipitation[i] > 0 || hourly.precipitation_probability[i] > 50) {
            precipitationSoon = true
            precipMinutes = Math.round(hoursDiff * 60)
            break
          }
        }
      }
      
      if (current.precipitation > 0) {
        setRainAlert({
          type: 'raining',
          message: '¡Está lloviendo ahora!',
          precipitation: current.precipitation
        })
      } else if (precipitationSoon) {
        setRainAlert({
          type: 'soon',
          message: precipMinutes <= 15 
            ? `🚨 ¡Lluvia en ~${precipMinutes} minutos!`
            : `⚠️ Lluvia probable en ~${precipMinutes} min`,
          minutes: precipMinutes
        })
      } else {
        setRainAlert({
          type: 'clear',
          message: '☀️ Sin lluvia próxima',
          minutes: null
        })
      }
      
      setLastUpdate(new Date().toLocaleTimeString('es-MX'))
      setLoading(false)
      
    } catch (error) {
      console.error('Error fetching weather:', error)
      setLoading(false)
    }
  }

  useEffect(() => {
    checkRain()
    // Refresh every 5 minutes
    const interval = setInterval(checkRain, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const getWeatherIcon = (code) => {
    if (code <= 3) return '☀️'
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
    return 'bg-green-700'
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-1">🌧️ Lluvia Alert</h1>
          <p className="text-gray-400 text-sm">{LOCATION_NAME}</p>
        </div>

        {/* Install App Button */}
        {showInstall && (
          <button
            onClick={installApp}
            className="w-full bg-blue-600 hover:bg-blue-500 rounded-xl p-4 mb-4 flex items-center justify-center gap-2 transition-colors"
          >
            <span className="text-xl">📲</span>
            <span className="font-semibold">Instalar App</span>
          </button>
        )}

        {/* Main Alert Card */}
        <div className={`${getAlertColor()} rounded-2xl p-6 mb-4 transition-all duration-500`}>
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin text-4xl mb-2">🔄</div>
              <p>Consultando radar...</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-5xl mb-3">
                {rainAlert?.type === 'raining' && '🌧️'}
                {rainAlert?.type === 'soon' && rainAlert?.minutes <= 15 && '🚨'}
                {rainAlert?.type === 'soon' && rainAlert?.minutes > 15 && '⚠️'}
                {rainAlert?.type === 'clear' && '☀️'}
              </div>
              <p className="text-2xl font-bold mb-2">{rainAlert?.message}</p>
              {rainAlert?.type === 'raining' && (
                <p className="text-sm opacity-80">
                  Precipitación: {rainAlert.precipitation} mm
                </p>
              )}
            </div>
          )}
        </div>

        {/* Current Conditions */}
        {forecast && (
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <h2 className="text-sm text-gray-400 mb-2">Condiciones actuales</h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-4xl">
                  {getWeatherIcon(forecast.current?.weather_code)}
                </span>
                <span className="text-3xl font-bold">
                  {Math.round(forecast.current?.temperature_2m)}°C
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Hourly Forecast */}
        {forecast?.hourly && (
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <h2 className="text-sm text-gray-400 mb-3">Próximas horas</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {forecast.hourly.time.slice(0, 8).map((time, i) => {
                const hour = new Date(time).getHours()
                const prob = forecast.hourly.precipitation_probability[i]
                return (
                  <div key={i} className="flex-shrink-0 text-center">
                    <p className="text-xs text-gray-400">{hour}:00</p>
                    <p className="text-lg my-1">
                      {getWeatherIcon(forecast.hourly.weather_code[i])}
                    </p>
                    <p className={`text-xs ${prob > 50 ? 'text-blue-400' : 'text-gray-500'}`}>
                      {prob}%
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Refresh Button */}
        <button
          onClick={checkRain}
          className="w-full bg-gray-800 hover:bg-gray-700 rounded-xl p-3 mb-4 transition-colors"
        >
          🔄 Actualizar ahora
        </button>

        {/* Footer */}
        <div className="text-center text-xs text-gray-500">
          <p>Última actualización: {lastUpdate || '...'}</p>
          <p className="mt-1">Datos: Open-Meteo + RainViewer</p>
          <p className="mt-2">Creado por C-Cloud | Colmena 2026</p>
        </div>
      </div>
    </main>
  )
}
