import React, { useState, useEffect } from 'react';
import { MapPin, Navigation, Info, Compass } from 'lucide-react';

interface MapMockProps {
  siteLat: number;
  siteLng: number;
  siteName: string;
  userLat: number;
  userLng: number;
  onCoordinatesChange: (lat: number, lng: number) => void;
  radius: number; // usually 100
}

// Calculate distance in meters using Haversine formula
export function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

export default function MapMock({
  siteLat,
  siteLng,
  siteName,
  userLat,
  userLng,
  onCoordinatesChange,
  radius,
}: MapMockProps) {
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const distance = getHaversineDistance(siteLat, siteLng, userLat, userLng);
  const isWithinRange = distance <= radius;

  // Request actual browser geolocation
  const triggerActualGeolocation = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onCoordinatesChange(position.coords.latitude, position.coords.longitude);
        setGpsLoading(false);
      },
      (error) => {
        console.warn('Geolocation failed', error);
        setGpsError('Could not retrieve actual GPS coordinates. Utilizing mock offsets.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  // Preset offsets for quick sandbox testing
  const setToInRange = () => {
    onCoordinatesChange(siteLat, siteLng);
  };

  const setToOutOfRange = () => {
    onCoordinatesChange(siteLat + 0.005, siteLng + 0.005);
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm" id="gps-verification-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-600 flex items-center gap-2">
          <Compass className="w-4 h-4 text-blue-500 animate-spin" style={{ animationDuration: '6s' }} />
          GPS Proximity Radar
        </h3>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            isWithinRange
              ? 'bg-green-100 text-green-700 border border-green-200'
              : 'bg-red-100 text-red-700 border border-red-200'
          }`}
          id="proximity-status"
        >
          {isWithinRange ? 'Within Range (≤100m)' : 'Out of Range (>100m)'}
        </span>
      </div>

      {/* SVG Radar Visualizer */}
      <div className="relative h-44 w-full bg-gray-50 rounded-xl my-3 flex items-center justify-center overflow-hidden border border-gray-200">
        {/* Radar Rings */}
        <div className="absolute w-36 h-36 rounded-full border border-gray-300 animate-ping opacity-30" />
        <div className="absolute w-28 h-28 rounded-full border border-gray-300" />
        <div className="absolute w-16 h-16 rounded-full border border-gray-200" />
        <div className="absolute w-full h-[1px] bg-gray-200" />
        <div className="absolute h-full w-[1px] bg-gray-200" />

        {/* Target Job Site (Center) */}
        <div className="absolute z-10 flex flex-col items-center">
          <div className="w-6 h-6 bg-green-500 border-2 border-white rounded-full flex items-center justify-center animate-pulse shadow-md">
            <MapPin className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded mt-1 truncate max-w-[120px] text-gray-700 font-medium shadow-sm">
            {siteName}
          </span>
        </div>

        {/* User GPS Dot (Shifted depending on coordinate distance) */}
        <div
          className="absolute z-20 flex flex-col items-center transition-all duration-500"
          style={{
            transform: `translate(${Math.min(
              60,
              Math.max(-60, (userLng - siteLng) * 15000)
            )}px, ${Math.min(60, Math.max(-60, -(userLat - siteLat) * 15000))}px)`,
          }}
        >
          <div
            className={`w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow-md ${
              isWithinRange ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
            }`}
          >
            <Navigation className="w-2.5 h-2.5 text-white transform rotate-45" />
          </div>
          <span className="text-[9px] bg-blue-50 border border-blue-200 px-1 py-0.5 rounded mt-1 text-blue-700">
            You
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-500">Calculated Distance:</span>
          <span className="font-mono text-sm font-semibold text-gray-800">
            {distance < 1000 ? `${distance.toFixed(1)} meters` : `${(distance / 1000).toFixed(2)} km`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
          <div>
            <div className="text-[10px] text-gray-400">USER LAT / LNG</div>
            <div className="truncate text-gray-700">{userLat.toFixed(6)}, {userLng.toFixed(6)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">SITE LAT / LNG</div>
            <div className="truncate text-gray-700">{siteLat.toFixed(6)}, {siteLng.toFixed(6)}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={triggerActualGeolocation}
              disabled={gpsLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 active:translate-y-px transition-all rounded-lg py-2 px-3 text-xs font-semibold flex items-center justify-center gap-1 text-white shadow-sm disabled:opacity-50 cursor-pointer"
              id="get-real-gps-btn"
            >
              <Navigation className="w-3.5 h-3.5" />
              {gpsLoading ? 'Detecting...' : 'Get Actual GPS'}
            </button>

            <button
              type="button"
              onClick={setToInRange}
              className="flex-1 bg-gray-100 hover:bg-green-50 text-green-700 border border-gray-200 hover:border-green-200 active:translate-y-px transition-all rounded-lg py-2 px-3 text-xs font-semibold cursor-pointer"
              id="mock-in-range-btn"
            >
              Mock: In Range
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={setToOutOfRange}
              className="flex-1 bg-gray-100 hover:bg-red-50 text-red-600 border border-gray-200 hover:border-red-200 active:translate-y-px transition-all rounded-lg py-2 px-3 text-xs font-semibold cursor-pointer"
              id="mock-out-range-btn"
            >
              Mock: Out of Range
            </button>
          </div>
        </div>

        {gpsError && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2" id="gps-error-alert">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-700 font-medium leading-normal">{gpsError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
