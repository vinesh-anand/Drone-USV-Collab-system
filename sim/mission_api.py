#!/usr/bin/env python3
"""
Mission API
===========

Local HTTP API between the React Mission Planner and the
PX4 MAVLink Mission Bridge.

Architecture:

    React Mission Planner
            |
            | HTTP
            v
    mission_api.py :8765
            |
            v
    MissionBridge
            |
            | MAVLink UDP :14540
            v
        PX4 SITL

This server is intended for local development/simulation.
It binds to 127.0.0.1 by default.
"""

from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional

from mission_bridge import (
    DEFAULT_CONNECTION,
    MissionBridge,
    MissionRequest,
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HOST = "127.0.0.1"
PORT = 8765

MAX_REQUEST_SIZE = 2 * 1024 * 1024


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

LOGGER = logging.getLogger("mission_api")


# ---------------------------------------------------------------------------
# Global bridge
# ---------------------------------------------------------------------------

bridge = MissionBridge(
    connection_string=DEFAULT_CONNECTION,
)

bridge_lock = threading.RLock()


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def json_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    payload: Dict[str, Any],
) -> None:
    body = json.dumps(
        payload,
        indent=2,
    ).encode("utf-8")

    handler.send_response(status_code)

    handler.send_header(
        "Content-Type",
        "application/json; charset=utf-8",
    )

    handler.send_header(
        "Content-Length",
        str(len(body)),
    )

    handler.send_header(
        "Access-Control-Allow-Origin",
        "*",
    )

    handler.send_header(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS",
    )

    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type",
    )

    handler.end_headers()

    handler.wfile.write(body)


def read_json_body(
    handler: BaseHTTPRequestHandler,
) -> Dict[str, Any]:
    content_length = int(
        handler.headers.get(
            "Content-Length",
            "0",
        )
    )

    if content_length <= 0:
        raise ValueError(
            "Request body is empty."
        )

    if content_length > MAX_REQUEST_SIZE:
        raise ValueError(
            "Request body is too large."
        )

    raw_body = handler.rfile.read(
        content_length
    )

    try:
        payload = json.loads(
            raw_body.decode("utf-8")
        )
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Invalid JSON: {exc}"
        ) from exc

    if not isinstance(payload, dict):
        raise ValueError(
            "JSON root must be an object."
        )

    return payload


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class MissionAPIHandler(
    BaseHTTPRequestHandler
):
    """
    HTTP API handler.

    The frontend communicates with this server using fetch().
    """

    server_version = "DroneMissionAPI/1.0"

    # -----------------------------------------------------------------------
    # Logging
    # -----------------------------------------------------------------------

    def log_message(
        self,
        format_string: str,
        *args: Any,
    ) -> None:
        LOGGER.info(
            "%s - %s",
            self.address_string(),
            format_string % args,
        )

    # -----------------------------------------------------------------------
    # CORS
    # -----------------------------------------------------------------------

    def do_OPTIONS(self) -> None:
        self.send_response(204)

        self.send_header(
            "Access-Control-Allow-Origin",
            "*",
        )

        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS",
        )

        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type",
        )

        self.end_headers()

    # -----------------------------------------------------------------------
    # GET
    # -----------------------------------------------------------------------

    def do_GET(self) -> None:
        try:
            if self.path == "/health":
                self.handle_health()
                return

            if self.path == "/state":
                self.handle_state()
                return

            if self.path == "/":
                self.handle_root()
                return

            json_response(
                self,
                404,
                {
                    "success": False,
                    "error": "Endpoint not found.",
                },
            )

        except Exception as exc:
            LOGGER.exception(
                "GET request failed."
            )

            json_response(
                self,
                500,
                {
                    "success": False,
                    "error": str(exc),
                },
            )

    # -----------------------------------------------------------------------
    # POST
    # -----------------------------------------------------------------------

    def do_POST(self) -> None:
        try:
            if self.path == "/mission/upload":
                self.handle_upload()
                return

            if self.path == "/mission/start":
                self.handle_start()
                return

            if self.path == "/mission/pause":
                self.handle_pause()
                return

            if self.path == "/mission/resume":
                self.handle_resume()
                return

            if self.path == "/mission/abort":
                self.handle_abort()
                return

            json_response(
                self,
                404,
                {
                    "success": False,
                    "error": "Endpoint not found.",
                },
            )

        except ValueError as exc:
            json_response(
                self,
                400,
                {
                    "success": False,
                    "error": str(exc),
                },
            )

        except Exception as exc:
            LOGGER.exception(
                "POST request failed."
            )

            json_response(
                self,
                500,
                {
                    "success": False,
                    "error": str(exc),
                },
            )

    # -----------------------------------------------------------------------
    # Root
    # -----------------------------------------------------------------------

    def handle_root(self) -> None:
        json_response(
            self,
            200,
            {
                "service": "Drone Mission API",
                "version": "1.0",
                "mavlink": DEFAULT_CONNECTION,
                "endpoints": {
                    "health": "GET /health",
                    "state": "GET /state",
                    "upload": "POST /mission/upload",
                    "start": "POST /mission/start",
                    "pause": "POST /mission/pause",
                    "resume": "POST /mission/resume",
                    "abort": "POST /mission/abort",
                },
            },
        )

    # -----------------------------------------------------------------------
    # Health
    # -----------------------------------------------------------------------

    def handle_health(self) -> None:
        with bridge_lock:
            state = bridge.get_state()

        json_response(
            self,
            200,
            {
                "success": True,
                "service": "mission_api",
                "bridge_connected": state["connected"],
                "mavlink_connection": DEFAULT_CONNECTION,
            },
        )

    # -----------------------------------------------------------------------
    # State
    # -----------------------------------------------------------------------

    def handle_state(self) -> None:
        with bridge_lock:
            state = bridge.get_state()

        json_response(
            self,
            200,
            {
                "success": True,
                "state": state,
            },
        )

    # -----------------------------------------------------------------------
    # Mission upload
    # -----------------------------------------------------------------------

    def handle_upload(self) -> None:
        payload = read_json_body(
            self
        )

        request = MissionRequest.from_dict(
            payload
        )

        LOGGER.info(
            "Mission upload requested: vehicle=%s items=%d",
            request.vehicle,
            len(request.mission),
        )

        with bridge_lock:
            result = bridge.upload_mission(
                request.mission
            )

        json_response(
            self,
            200,
            {
                "success": True,
                "action": "upload",
                "vehicle": request.vehicle,
                "result": result,
            },
        )

    # -----------------------------------------------------------------------
    # Mission start
    # -----------------------------------------------------------------------

    def handle_start(self) -> None:
        with bridge_lock:
            bridge.start_mission()

        json_response(
            self,
            200,
            {
                "success": True,
                "action": "start",
            },
        )

    # -----------------------------------------------------------------------
    # Mission pause
    # -----------------------------------------------------------------------

    def handle_pause(self) -> None:
        with bridge_lock:
            bridge.pause_mission()

        json_response(
            self,
            200,
            {
                "success": True,
                "action": "pause",
            },
        )

    # -----------------------------------------------------------------------
    # Mission resume
    # -----------------------------------------------------------------------

    def handle_resume(self) -> None:
        with bridge_lock:
            bridge.resume_mission()

        json_response(
            self,
            200,
            {
                "success": True,
                "action": "resume",
            },
        )

    # -----------------------------------------------------------------------
    # Mission abort
    # -----------------------------------------------------------------------

    def handle_abort(self) -> None:
        with bridge_lock:
            bridge.abort_mission()

        json_response(
            self,
            200,
            {
                "success": True,
                "action": "abort",
            },
        )


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class MissionAPIServer(
    ThreadingHTTPServer
):
    allow_reuse_address = True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    LOGGER.info(
        "Starting Mission API..."
    )

    LOGGER.info(
        "MAVLink endpoint: %s",
        DEFAULT_CONNECTION,
    )

    LOGGER.info(
        "HTTP endpoint: http://%s:%d",
        HOST,
        PORT,
    )

    # Connect to PX4 before accepting dashboard requests.
    try:
        bridge.connect()
    except Exception as exc:
        LOGGER.error(
            "Could not connect to PX4 SITL: %s",
            exc,
        )

        LOGGER.error(
            "Start PX4 SITL/MAVROS first, then restart this API."
        )

        return

    server = MissionAPIServer(
        (
            HOST,
            PORT,
        ),
        MissionAPIHandler,
    )

    try:
        LOGGER.info(
            "Mission API is ready."
        )

        LOGGER.info(
            "Waiting for Mission Planner requests..."
        )

        server.serve_forever()

    except KeyboardInterrupt:
        LOGGER.info(
            "Stopping Mission API..."
        )

    finally:
        server.shutdown()
        server.server_close()
        bridge.close()


if __name__ == "__main__":
    main()