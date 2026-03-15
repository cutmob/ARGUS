"use client";

import { useState, useEffect, useCallback } from "react";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerates available video input devices. Re-enumerates when a device
 * is added or removed. Returns a stable list of {deviceId, label} pairs
 * and a selectedId / setSelectedId to control which camera is active.
 */
export function useCameraDevices() {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const enumerate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
      setDevices(videoInputs);

      // Auto-select first device if nothing selected yet
      setSelectedId((prev) => {
        if (prev && videoInputs.some((d) => d.deviceId === prev)) return prev;
        // Check localStorage for a saved preference
        const saved =
          typeof window !== "undefined"
            ? localStorage.getItem("argus_camera_device")
            : null;
        if (saved && videoInputs.some((d) => d.deviceId === saved)) return saved;
        return videoInputs[0]?.deviceId ?? "";
      });
    } catch {
      // Permission denied or not available — leave empty
    }
  }, []);

  useEffect(() => {
    enumerate();
    // Re-enumerate when devices change (plug/unplug USB camera)
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", enumerate);
      return () =>
        navigator.mediaDevices.removeEventListener("devicechange", enumerate);
    }
  }, [enumerate]);

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedId(deviceId);
    if (typeof window !== "undefined") {
      localStorage.setItem("argus_camera_device", deviceId);
    }
  }, []);

  return { devices, selectedId, selectDevice };
}
