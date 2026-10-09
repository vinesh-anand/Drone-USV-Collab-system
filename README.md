# DRONE + FASTY (SROTA) CONTROL DASHBOARD

A standalone robotics mission-control dashboard for monitoring and operating a **drone** and the **FASTY / SROTA surface-water rescue platform** from a unified cockpit interface.

## Overview

The dashboard is designed as a single-page command console with a dark industrial aerospace/robotics interface.

It provides a centralized operational view for:

- 🚁 Drone telemetry and flight status
- 🛟 FASTY / SROTA rescue-platform telemetry
- 🎥 Camera feeds
- 🗺️ Mission map and vehicle positions
- 📡 Communications and system status
- 🎯 Mission and navigation information
- ⚠️ Safety and emergency controls

## Technology

- React
- TypeScript
- TanStack Start
- TanStack Router
- Vite
- Tailwind CSS
- Lucide React
- Recharts

## Project Structure

```text
src/
├── components/
│   └── cockpit/
│       ├── ControlBar
│       ├── DronePanel
│       ├── FastyPanel
│       ├── MissionMap
│       ├── TopBar
│       ├── VideoFeed
│       └── primitives
│
├── lib/
│   ├── cameras.ts
│   └── telemetry.ts
│
├── routes/
│   ├── __root.tsx
│   └── index.tsx
│
└── styles.css
```
# Drone-USV-Collab-system
