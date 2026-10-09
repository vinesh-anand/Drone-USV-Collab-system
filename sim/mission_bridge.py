#!/usr/bin/env python3
"""
Mission Bridge
==============

Bridges the web Mission Planner to ArduPilot SITL through MAVLink.

Current architecture:

    Mission Planner
          |
          | mission JSON / future API
          v
    Mission Bridge
          |
          | MAVLink UDP 14554
          v
    ArduCopter SITL
          |
          +---- UDP 14550 ----> MAVROS
          |
          v
    ROS / ROSBridge
          |
          v
    Mission Map

The bridge is intentionally independent from the React application.

Supported mission item types:

    TAKEOFF
    WAYPOINT
    LOITER
    LAND
    RTL

FASTY_TARGET is intentionally not uploaded as a normal
ArduCopter flight mission item. It belongs to the rescue/target
management layer.

Current vehicle:

    DRONE = ArduCopter SITL, MAVLink system 1

FASTY / ArduRover support will be added separately.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from pymavlink import mavutil
except ImportError:
    mavutil = None


# ============================================================================
# Configuration
# ============================================================================

# IMPORTANT:
# MAVROS already receives Drone MAVLink on UDP 14550.
# The mission bridge therefore uses a separate MAVProxy output: 14554.
DEFAULT_CONNECTION = "udpin:0.0.0.0:14554"

DEFAULT_SOURCE_SYSTEM = 255
DEFAULT_SOURCE_COMPONENT = 190

EXPECTED_DRONE_SYSTEM = 1

HEARTBEAT_TIMEOUT_SECONDS = 10.0
COMMAND_TIMEOUT_SECONDS = 8.0
MISSION_TIMEOUT_SECONDS = 20.0


# ============================================================================
# Logging
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

LOGGER = logging.getLogger("mission_bridge")


# ============================================================================
# Data structures
# ============================================================================

@dataclass
class MissionItem:
    """
    Mirrors the TypeScript MissionItem shape used by missionStore.ts.
    """

    id: int
    type: str
    label: str
    latitude: Optional[float]
    longitude: Optional[float]
    altitude: Optional[float]
    speed: Optional[float]
    hold: Optional[float]

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "MissionItem":
        return cls(
            id=int(value.get("id", 0)),
            type=str(value.get("type", "")).upper(),
            label=str(value.get("label", "")),
            latitude=_optional_float(value.get("latitude")),
            longitude=_optional_float(value.get("longitude")),
            altitude=_optional_float(value.get("altitude")),
            speed=_optional_float(value.get("speed")),
            hold=_optional_float(value.get("hold")),
        )


@dataclass
class MissionRequest:
    """
    Expected JSON:

    {
        "mission": [
            {
                "id": 1,
                "type": "TAKEOFF",
                "label": "Takeoff",
                "latitude": null,
                "longitude": null,
                "altitude": 20,
                "speed": null,
                "hold": null
            }
        ],
        "vehicle": "DRONE"
    }
    """

    mission: List[MissionItem]
    vehicle: str = "DRONE"

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "MissionRequest":
        raw_mission = value.get("mission", [])

        if not isinstance(raw_mission, list):
            raise ValueError("'mission' must be an array.")

        mission = [
            MissionItem.from_dict(item)
            for item in raw_mission
            if isinstance(item, dict)
        ]

        return cls(
            mission=mission,
            vehicle=str(
                value.get("vehicle", "DRONE")
            ).upper(),
        )


# ============================================================================
# Utility functions
# ============================================================================

def _optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None

    try:
        result = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(result):
        return None

    return result


def _is_valid_latitude(value: Optional[float]) -> bool:
    return value is not None and -90.0 <= value <= 90.0


def _is_valid_longitude(value: Optional[float]) -> bool:
    return value is not None and -180.0 <= value <= 180.0


def _has_valid_coordinates(item: MissionItem) -> bool:
    return (
        _is_valid_latitude(item.latitude)
        and _is_valid_longitude(item.longitude)
    )


def _require_pymavlink() -> None:
    if mavutil is None:
        raise RuntimeError(
            "pymavlink is not installed.\n"
            "Install it with:\n"
            "python3 -m pip install pymavlink"
        )


# ============================================================================
# Mission Bridge
# ============================================================================

class MissionBridge:
    """
    ArduPilot MAVLink mission bridge.

    Default connection:

        udpin:0.0.0.0:14554

    MAVProxy should forward the ArduCopter MAVLink stream to 14554.

    Drone MAVROS continues using 14550.
    """

    def __init__(
        self,
        connection_string: str = DEFAULT_CONNECTION,
        source_system: int = DEFAULT_SOURCE_SYSTEM,
        source_component: int = DEFAULT_SOURCE_COMPONENT,
    ) -> None:
        _require_pymavlink()

        self.connection_string = connection_string
        self.source_system = source_system
        self.source_component = source_component

        self.connection: Any = None

        self.target_system: Optional[int] = None
        self.target_component: Optional[int] = None

        self.connected = False
        self.armed = False
        self.current_mode: Optional[str] = None

        self.current_latitude: Optional[float] = None
        self.current_longitude: Optional[float] = None
        self.current_altitude: Optional[float] = None
        self.current_relative_altitude: Optional[float] = None

        self.current_mission_index: Optional[int] = None

        self._receive_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        self._state_lock = threading.RLock()

        # Critical:
        # Mission upload waits for MISSION_REQUEST_INT / MISSION_ACK.
        # The background receive thread must not consume those messages.
        self._mavlink_io_lock = threading.RLock()

    # ------------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------------

    def connect(self) -> None:
        LOGGER.info(
            "Connecting to ArduPilot SITL: %s",
            self.connection_string,
        )

        self.connection = mavutil.mavlink_connection(
            self.connection_string,
            source_system=self.source_system,
            source_component=self.source_component,
        )

        LOGGER.info("Waiting for ArduPilot heartbeat...")

        heartbeat = self.connection.wait_heartbeat(
            timeout=HEARTBEAT_TIMEOUT_SECONDS
        )

        if heartbeat is None:
            raise RuntimeError(
                "ArduPilot heartbeat was not received."
            )

        self.target_system = self.connection.target_system
        self.target_component = self.connection.target_component

        if self.target_system != EXPECTED_DRONE_SYSTEM:
            LOGGER.warning(
                "Expected Drone system %s but received system %s.",
                EXPECTED_DRONE_SYSTEM,
                self.target_system,
            )

        self.connected = True

        self._handle_heartbeat(heartbeat)

        LOGGER.info(
            "Connected: system=%s component=%s",
            self.target_system,
            self.target_component,
        )

        LOGGER.info(
            "Autopilot=%s vehicle_type=%s",
            heartbeat.autopilot,
            heartbeat.type,
        )

        self._start_receive_thread()

    def close(self) -> None:
        self._stop_event.set()
        self.connected = False

        if self._receive_thread is not None:
            self._receive_thread.join(timeout=2.0)

        if self.connection is not None:
            try:
                self.connection.close()
            except Exception:
                pass

        self.connection = None

        LOGGER.info("Mission bridge disconnected.")

    def _start_receive_thread(self) -> None:
        if (
            self._receive_thread is not None
            and self._receive_thread.is_alive()
        ):
            return

        self._receive_thread = threading.Thread(
            target=self._receive_loop,
            name="ardupilot-mavlink-receive",
            daemon=True,
        )

        self._receive_thread.start()

    # ------------------------------------------------------------------------
    # MAVLink receive loop
    # ------------------------------------------------------------------------

    def _receive_loop(self) -> None:
        if self.connection is None:
            return

        while not self._stop_event.is_set():
            try:
                with self._mavlink_io_lock:
                    message = self.connection.recv_match(
                        blocking=True,
                        timeout=1.0,
                    )
            except Exception as exc:
                LOGGER.warning(
                    "MAVLink receive error: %s",
                    exc,
                )
                continue

            if message is None:
                continue

            try:
                self._handle_message(message)
            except Exception:
                LOGGER.exception(
                    "Error handling MAVLink message."
                )

    def _handle_message(self, message: Any) -> None:
        message_type = message.get_type()

        if message_type == "HEARTBEAT":
            self._handle_heartbeat(message)

        elif message_type == "GLOBAL_POSITION_INT":
            self._handle_global_position(message)

        elif message_type == "MISSION_CURRENT":
            self._handle_mission_current(message)

    def _handle_heartbeat(self, message: Any) -> None:
        base_mode = int(
            getattr(message, "base_mode", 0)
        )

        armed = bool(
            base_mode
            & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
        )

        with self._state_lock:
            self.connected = True
            self.armed = armed

            if self.connection is not None:
                self.current_mode = getattr(
                    self.connection,
                    "flightmode",
                    None,
                )

    def _handle_global_position(self, message: Any) -> None:
        latitude = getattr(message, "lat", None)
        longitude = getattr(message, "lon", None)
        altitude = getattr(message, "alt", None)
        relative_altitude = getattr(
            message,
            "relative_alt",
            None,
        )

        with self._state_lock:
            if latitude is not None:
                self.current_latitude = (
                    float(latitude) / 10_000_000.0
                )

            if longitude is not None:
                self.current_longitude = (
                    float(longitude) / 10_000_000.0
                )

            if altitude is not None:
                self.current_altitude = (
                    float(altitude) / 1000.0
                )

            if relative_altitude is not None:
                self.current_relative_altitude = (
                    float(relative_altitude) / 1000.0
                )

    def _handle_mission_current(self, message: Any) -> None:
        sequence = getattr(message, "seq", None)

        if sequence is not None:
            with self._state_lock:
                self.current_mission_index = int(sequence)

    # ------------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------------

    def get_state(self) -> Dict[str, Any]:
        with self._state_lock:
            return {
                "connected": self.connected,
                "system": self.target_system,
                "component": self.target_component,
                "armed": self.armed,
                "mode": self.current_mode,
                "latitude": self.current_latitude,
                "longitude": self.current_longitude,
                "altitude": self.current_altitude,
                "relative_altitude": (
                    self.current_relative_altitude
                ),
                "mission_index": self.current_mission_index,
            }

    # ------------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------------

    def validate_mission(
        self,
        mission: Sequence[MissionItem],
    ) -> List[str]:
        errors: List[str] = []

        if not mission:
            errors.append("Mission is empty.")
            return errors

        if mission[0].type != "TAKEOFF":
            errors.append(
                "The first mission item must be TAKEOFF."
            )

        supported_types = {
            "TAKEOFF",
            "WAYPOINT",
            "LOITER",
            "LAND",
            "RTL",
            "FASTY_TARGET",
        }

        for index, item in enumerate(mission):
            mission_type = item.type

            if mission_type not in supported_types:
                errors.append(
                    f"Mission item {item.id} has unsupported "
                    f"type '{mission_type}'."
                )
                continue

            # FASTY_TARGET is handled later by the rescue layer.
            if mission_type == "FASTY_TARGET":
                continue

            if mission_type in {
                "WAYPOINT",
                "LOITER",
                "LAND",
            }:
                if not _has_valid_coordinates(item):
                    errors.append(
                        f"Mission item {item.id} "
                        f"({mission_type}) requires valid "
                        "latitude and longitude."
                    )

            if mission_type == "TAKEOFF":
                if (
                    item.altitude is not None
                    and item.altitude < 0
                ):
                    errors.append(
                        f"Mission item {item.id} has an "
                        "invalid takeoff altitude."
                    )

            if mission_type == "WAYPOINT":
                if (
                    item.altitude is not None
                    and item.altitude < 0
                ):
                    errors.append(
                        f"Mission item {item.id} has an "
                        "invalid waypoint altitude."
                    )

            if mission_type == "LOITER":
                if (
                    item.hold is not None
                    and item.hold < 0
                ):
                    errors.append(
                        f"Mission item {item.id} has an "
                        "invalid loiter hold time."
                    )

            if index == 0 and mission_type == "RTL":
                errors.append(
                    "RTL cannot be the first mission item."
                )

        return errors

    # ------------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------------

    def _require_connection(self) -> Any:
        if self.connection is None or not self.connected:
            raise RuntimeError(
                "MAVLink connection is not active."
            )

        return self.connection

    def _target(self) -> Tuple[int, int]:
        if self.target_system is None:
            raise RuntimeError(
                "MAVLink target system is unknown."
            )

        if self.target_component is None:
            raise RuntimeError(
                "MAVLink target component is unknown."
            )

        return (
            self.target_system,
            self.target_component,
        )

    # ------------------------------------------------------------------------
    # Mission upload
    # ------------------------------------------------------------------------

    def upload_mission(
        self,
        mission: Sequence[MissionItem],
    ) -> Dict[str, Any]:
        errors = self.validate_mission(mission)

        if errors:
            raise ValueError(
                "Mission validation failed:\n- "
                + "\n- ".join(errors)
            )

        connection = self._require_connection()

        flight_items = [
            item
            for item in mission
            if item.type != "FASTY_TARGET"
        ]

        if not flight_items:
            raise ValueError(
                "Mission contains no ArduPilot flight items."
            )

        LOGGER.info(
            "Uploading %d ArduPilot mission items...",
            len(flight_items),
        )

        uploaded = 0

        # Prevent the background receive loop from consuming
        # MISSION_REQUEST / MISSION_ACK messages.
        with self._mavlink_io_lock:
            connection.mav.mission_count_send(
                self.target_system,
                self.target_component,
                len(flight_items),
                0,
            )

            deadline = (
                time.monotonic()
                + MISSION_TIMEOUT_SECONDS
            )

            while time.monotonic() < deadline:
                message = connection.recv_match(
                    type=[
                        "MISSION_REQUEST_INT",
                        "MISSION_REQUEST",
                        "MISSION_ACK",
                    ],
                    blocking=True,
                    timeout=1.0,
                )

                if message is None:
                    continue

                message_type = message.get_type()

                if message_type in {
                    "MISSION_REQUEST_INT",
                    "MISSION_REQUEST",
                }:
                    sequence = int(
                        getattr(message, "seq", -1)
                    )

                    if (
                        sequence < 0
                        or sequence >= len(flight_items)
                    ):
                        raise RuntimeError(
                            "ArduPilot requested invalid "
                            f"mission sequence {sequence}."
                        )

                    item = flight_items[sequence]

                    self._send_mission_item(
                        item,
                        sequence,
                    )

                    uploaded += 1

                    LOGGER.info(
                        "Mission item %d/%d uploaded: %s",
                        sequence + 1,
                        len(flight_items),
                        item.type,
                    )

                elif message_type == "MISSION_ACK":
                    result = int(
                        getattr(message, "type", -1)
                    )

                    accepted = getattr(
                        mavutil.mavlink,
                        "MAV_MISSION_ACCEPTED",
                        0,
                    )

                    if result != accepted:
                        raise RuntimeError(
                            "ArduPilot rejected mission upload. "
                            f"MISSION_ACK type={result}"
                        )

                    LOGGER.info(
                        "ArduPilot accepted mission upload."
                    )

                    return {
                        "success": True,
                        "uploaded": uploaded,
                        "total": len(flight_items),
                    }

        raise TimeoutError(
            "Timed out while uploading mission to ArduPilot."
        )

    def _send_mission_item(
        self,
        item: MissionItem,
        sequence: int,
    ) -> None:
        connection = self._require_connection()

        latitude = item.latitude
        longitude = item.longitude

        # Mission Planner does not require TAKEOFF coordinates.
        # For ArduCopter, use the current launch position.
        if item.type == "TAKEOFF":
            if latitude is None or longitude is None:
                with self._state_lock:
                    latitude = self.current_latitude
                    longitude = self.current_longitude

            if latitude is None or longitude is None:
                raise RuntimeError(
                    "Current Drone GPS position is unavailable "
                    "for TAKEOFF."
                )

        if latitude is None:
            latitude = 0.0

        if longitude is None:
            longitude = 0.0

        altitude = (
            item.altitude
            if item.altitude is not None
            else 0.0
        )

        latitude_int = int(
            round(latitude * 10_000_000)
        )

        longitude_int = int(
            round(longitude * 10_000_000)
        )

        command, frame = self._mission_command(item)
        params = self._mission_parameters(item)

        # IMPORTANT:
        # autocontinue must be 1 for normal mission progression.
        connection.mav.mission_item_int_send(
            self.target_system,
            self.target_component,
            sequence,
            frame,
            command,
            1 if sequence == 0 else 0,
            1,
            params[0],
            params[1],
            params[2],
            params[3],
            params[4],
            params[5],
            params[6],
            latitude_int,
            longitude_int,
            float(altitude),
        )

    def _mission_command(
        self,
        item: MissionItem,
    ) -> Tuple[int, int]:
        frame = (
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        )

        if item.type == "TAKEOFF":
            return (
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                frame,
            )

        if item.type == "WAYPOINT":
            return (
                mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                frame,
            )

        if item.type == "LOITER":
            return (
                mavutil.mavlink.MAV_CMD_NAV_LOITER_TIME,
                frame,
            )

        if item.type == "LAND":
            return (
                mavutil.mavlink.MAV_CMD_NAV_LAND,
                frame,
            )

        if item.type == "RTL":
            return (
                mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
                frame,
            )

        raise ValueError(
            f"Unsupported ArduPilot mission item: {item.type}"
        )

    def _mission_parameters(
        self,
        item: MissionItem,
    ) -> Tuple[
        float,
        float,
        float,
        float,
        float,
        float,
        float,
    ]:
        # MAV_CMD_NAV_WAYPOINT
        #
        # param1 = hold time
        # param2 = acceptance radius
        # param3 = pass-through radius
        # param4 = yaw

        if item.type == "WAYPOINT":
            hold = (
                item.hold
                if item.hold is not None
                else 0.0
            )

            return (
                float(hold),
                0.0,
                0.0,
                float("nan"),
                0.0,
                0.0,
                0.0,
            )

        # MAV_CMD_NAV_LOITER_TIME
        #
        # param1 = loiter time

        if item.type == "LOITER":
            hold = (
                item.hold
                if item.hold is not None
                else 30.0
            )

            return (
                float(hold),
                0.0,
                0.0,
                float("nan"),
                0.0,
                0.0,
                0.0,
            )

        return (
            0.0,
            0.0,
            0.0,
            float("nan"),
            0.0,
            0.0,
            0.0,
        )

    # ------------------------------------------------------------------------
    # ArduCopter mission execution
    # ------------------------------------------------------------------------

    def start_mission(self) -> None:
        """
        Start ArduCopter mission execution.

        ArduCopter mission execution is performed through AUTO mode.
        The vehicle is armed first when required.
        """

        if not self.armed:
            self.arm()

        self.set_mode("AUTO")

        LOGGER.info(
            "ArduCopter mission execution requested: AUTO"
        )

    def pause_mission(self) -> None:
        """
        Pause the mission using ArduCopter LOITER mode.
        """

        self.set_mode("LOITER")

        LOGGER.info(
            "Mission paused: LOITER"
        )

    def resume_mission(self) -> None:
        """
        Resume the mission using ArduCopter AUTO mode.
        """

        self.set_mode("AUTO")

        LOGGER.info(
            "Mission resumed: AUTO"
        )

    def abort_mission(self) -> None:
        """
        Abort the mission and return to launch.
        """

        self.set_mode("RTL")

        LOGGER.info(
            "Mission aborted: RTL"
        )

    # ------------------------------------------------------------------------
    # Arming
    # ------------------------------------------------------------------------

    def arm(self) -> None:
        """
        Arm ArduCopter using MAV_CMD_COMPONENT_ARM_DISARM.
        """

        LOGGER.info("Requesting ArduCopter arm...")

        self._send_command_long(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
        )

        deadline = (
            time.monotonic()
            + COMMAND_TIMEOUT_SECONDS
        )

        while time.monotonic() < deadline:
            with self._state_lock:
                if self.armed:
                    LOGGER.info(
                        "ArduCopter armed."
                    )
                    return

            time.sleep(0.1)

        raise TimeoutError(
            "Timed out waiting for ArduCopter to arm."
        )

    # ------------------------------------------------------------------------
    # Flight modes
    # ------------------------------------------------------------------------

    def set_mode(self, mode: str) -> None:
        """
        Set an ArduCopter flight mode.

        Common modes:

            AUTO
            LOITER
            RTL
            LAND
            GUIDED
            STABILIZE
        """

        connection = self._require_connection()

        mode_mapping = connection.mode_mapping()

        if not mode_mapping:
            raise RuntimeError(
                "ArduPilot did not provide a flight-mode mapping."
            )

        normalized = mode.upper()

        if normalized not in mode_mapping:
            raise ValueError(
                f"ArduPilot does not expose mode "
                f"'{normalized}'. Available modes: "
                f"{', '.join(sorted(mode_mapping.keys()))}"
            )

        mode_id = mode_mapping[normalized]

        with self._mavlink_io_lock:
            connection.mav.set_mode_send(
                self.target_system,
                mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                mode_id,
            )

        LOGGER.info(
            "ArduPilot mode request sent: %s",
            normalized,
        )

    # ------------------------------------------------------------------------
    # MAVLink command helper
    # ------------------------------------------------------------------------

    def _send_command_long(
        self,
        command: int,
        param1: float = 0.0,
        param2: float = 0.0,
        param3: float = 0.0,
        param4: float = 0.0,
        param5: float = 0.0,
        param6: float = 0.0,
        param7: float = 0.0,
    ) -> None:
        connection = self._require_connection()

        with self._mavlink_io_lock:
            connection.mav.command_long_send(
                self.target_system,
                self.target_component,
                command,
                0,
                param1,
                param2,
                param3,
                param4,
                param5,
                param6,
                param7,
            )


# ============================================================================
# JSON
# ============================================================================

def load_mission_request(
    path: str,
) -> MissionRequest:
    with open(
        path,
        "r",
        encoding="utf-8",
    ) as handle:
        payload = json.load(handle)

    if not isinstance(payload, dict):
        raise ValueError(
            "Mission JSON root must be an object."
        )

    return MissionRequest.from_dict(payload)


def mission_to_json(
    mission: Sequence[MissionItem],
) -> str:
    return json.dumps(
        {
            "mission": [
                {
                    "id": item.id,
                    "type": item.type,
                    "label": item.label,
                    "latitude": item.latitude,
                    "longitude": item.longitude,
                    "altitude": item.altitude,
                    "speed": item.speed,
                    "hold": item.hold,
                }
                for item in mission
            ]
        },
        indent=2,
    )


# ============================================================================
# CLI
# ============================================================================

def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Mission bridge between the dashboard "
            "and ArduPilot SITL."
        )
    )

    parser.add_argument(
        "--connection",
        default=DEFAULT_CONNECTION,
        help=(
            "MAVLink connection string. "
            f"Default: {DEFAULT_CONNECTION}"
        ),
    )

    parser.add_argument(
        "--mission",
        default=None,
        help=(
            "Optional JSON mission file to upload "
            "immediately after connecting."
        ),
    )

    parser.add_argument(
        "--start",
        action="store_true",
        help=(
            "Start the uploaded mission immediately."
        ),
    )

    parser.add_argument(
        "--status",
        action="store_true",
        help=(
            "Print vehicle status after connecting."
        ),
    )

    return parser.parse_args()


# ============================================================================
# Main
# ============================================================================

def main() -> int:
    args = parse_arguments()

    bridge = MissionBridge(
        connection_string=args.connection,
    )

    try:
        bridge.connect()

        if args.status:
            print(
                json.dumps(
                    bridge.get_state(),
                    indent=2,
                )
            )

        if args.mission:
            request = load_mission_request(
                args.mission
            )

            if request.vehicle != "DRONE":
                LOGGER.warning(
                    "Mission vehicle is '%s'. "
                    "This bridge currently handles "
                    "the DRONE vehicle only.",
                    request.vehicle,
                )

            LOGGER.info(
                "Mission received with %d items.",
                len(request.mission),
            )

            result = bridge.upload_mission(
                request.mission
            )

            LOGGER.info(
                "Mission upload result: %s",
                result,
            )

            if args.start:
                bridge.start_mission()

        LOGGER.info(
            "ArduPilot mission bridge running."
        )

        LOGGER.info(
            "Press Ctrl+C to stop."
        )

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        LOGGER.info(
            "Stopping mission bridge..."
        )

    except Exception as exc:
        LOGGER.error(
            "Mission bridge failed: %s",
            exc,
        )
        return 1

    finally:
        bridge.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())